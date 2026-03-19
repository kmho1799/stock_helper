import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { STOCKS, CONFIG } from "./config.js";
import { fetchStockData, getMarketState, StockData } from "./indicators.js";
import { checkAlerts, analyzeSignal, SignalResult } from "./alertChecker.js";
import { initTelegram, sendMessage } from "./telegram.js";

const PERIODIC_SUMMARY_INTERVAL_MS = 30 * 60 * 1000;
let lastPeriodicSummaryAt: Date | null = null;

const prevSignalScores = new Map<string, number>();
const prevSignalFactors = new Map<string, SignalResult["factors"]>();
const prevSentIntradayRsiValues = new Map<string, number>();

const MARKET_STATE_LABEL: Record<string, string> = {
  REGULAR: "\uC815\uADDC\uC7A5",
  PRE: "\uD504\uB9AC\uB9C8\uCF13",
  PREPRE: "\uD504\uB9AC\uB9C8\uCF13",
  POST: "\uC560\uD504\uD130\uB9C8\uCF13",
  POSTPOST: "\uC560\uD504\uD130\uB9C8\uCF13",
  CLOSED: "\uD734\uC7A5",
};

interface CycleEntry {
  ticker: string;
  name: string;
  profile: string;
  price: number;
  dailyChangePercent: number;
  signal: SignalResult;
  alerts: string[];
  includeStrongSignal: boolean;
  prevSignalScore: number | null;
  prevFactors: SignalResult["factors"] | null;
  prevSentIntradayRsi: number | null;
  data: StockData;
}

interface MonitorCycleOptions {
  forceRun?: boolean;
}

function formatDirection(change: number): string {
  if (change > 0) return "\u25b2";
  if (change < 0) return "\u25bc";
  return "\u25a0";
}

function formatIntradayRsiState(value: number | null): string {
  if (value === null) return "N/A";
  if (value < 30) return "과매도";
  if (value < 45) return "약세";
  if (value < 55) return "중립";
  if (value < 70) return "상승 우위";
  return "과매수";
}

function formatIntradayRsiDelta(entry: CycleEntry): string {
  const current = entry.data.intradayRsi;
  if (current === null) return "N/A";

  const state = formatIntradayRsiState(current);
  if (entry.prevSentIntradayRsi === null) {
    return `${current.toFixed(1)} (첫 전송, ${state})`;
  }

  const delta = current - entry.prevSentIntradayRsi;
  let tone = "변화 제한적";
  if (delta >= 5) tone = current < 35 ? "과매도 반등 시도" : "상승 강화";
  else if (delta >= 2) tone = "완만한 상승";
  else if (delta <= -5) tone = current > 65 ? "과열 둔화" : "하락 강화";
  else if (delta <= -2) tone = "완만한 하락";

  return `${current.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}, ${tone}, ${state})`;
}

function summarizeAlerts(alerts: string[]): string[] {
  return alerts.map((alert) => alert.replace(/<[^>]+>/g, ""));
}

function getSignalEmoji(label: string): string {
  const map: Record<string, string> = {
    "\uAC15\uD55C \uB9E4\uC218": "\uD83D\uDFE2\uD83D\uDFE2",
    "\uB9E4\uC218": "\uD83D\uDFE2",
    "\uC911\uB9BD": "\u26AA",
    "\uB9E4\uB3C4": "\uD83D\uDD34",
    "\uAC15\uD55C \uB9E4\uB3C4": "\uD83D\uDD34\uD83D\uDD34",
  };
  return map[label] ?? "\u26AA";
}

function formatFactorsWithDelta(
  factors: SignalResult["factors"],
  prevFactors: SignalResult["factors"] | null
): string {
  const names: [keyof SignalResult["factors"], string][] = [
    ["trend", "\uCD94\uC138"],
    ["momentum", "\uBAA8\uBA58\uD140"],
    ["volatility", "\uBCC0\uB3D9\uC131"],
    ["flow", "\uC218\uAE09"],
    ["relative", "\uC0C1\uB300"],
  ];
  return names.map(([key, label]) => {
    const curr = factors[key];
    const sign = curr > 0 ? "+" : "";
    let arrow = "";
    if (prevFactors && curr !== prevFactors[key]) {
      arrow = curr > prevFactors[key] ? "\u2B06" : "\u2B07";
    }
    return `${label}${sign}${curr}${arrow}`;
  }).join(" ");
}

function categorizeAlerts(alerts: string[]): { events: string[]; warnings: string[] } {
  const warningPrefixes = ["[RSI]", "[\uC8FC\uBD09 RSI]", "[\uAC00\uACA9]", "[\uBCC0\uB3D9\uC131]"];
  const events: string[] = [];
  const warnings: string[] = [];

  for (const alert of alerts) {
    const clean = alert.replace(/^\[[^\]]+\]\s*/, "").replace(/<\/?b>/g, "");
    if (warningPrefixes.some((p) => alert.startsWith(p))) {
      warnings.push(clean);
    } else {
      events.push(clean);
    }
  }
  return { events, warnings };
}

function extractDetails(details: string[]): { trend: string[]; relative: string | null } {
  const trend: string[] = [];
  let relative: string | null = null;
  for (const detail of details) {
    if (detail.startsWith("\uCD94\uC138:")) {
      trend.push(detail.replace("\uCD94\uC138: ", ""));
    } else if (detail.startsWith("\uC0C1\uB300\uAC15\uB3C4:")) {
      relative = detail.replace("\uC0C1\uB300\uAC15\uB3C4: ", "");
    }
  }
  return { trend, relative };
}

function getCurrentHourInTimezone(timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());

  const hour = parts.find((part) => part.type === "hour")?.value;
  return hour ? parseInt(hour, 10) : 0;
}

function isWithinAlertDeliveryWindow(): boolean {
  const currentHour = getCurrentHourInTimezone(CONFIG.alertDeliveryTimezone);
  const { alertDeliveryStartHour: startHour, alertDeliveryEndHour: endHour } = CONFIG;

  if (startHour === endHour) return true;
  if (startHour < endHour) {
    return currentHour >= startHour && currentHour < endHour;
  }
  return currentHour >= startHour || currentHour < endHour;
}

async function appendAlertLogs(entries: CycleEntry[], marketState: string, summaryType: string): Promise<void> {
  if (entries.length === 0) return;

  const logDir = path.resolve(CONFIG.alertLogDir);
  const logFile = path.join(logDir, CONFIG.alertLogFile);
  await mkdir(logDir, { recursive: true });

  const lines = entries.map((entry) => JSON.stringify({
    timestamp: new Date().toISOString(),
    summaryType,
    marketState,
    ticker: entry.ticker,
    name: entry.name,
    profile: entry.profile,
    price: entry.price,
    dailyChangePercent: entry.dailyChangePercent,
    rsi: entry.data.rsi,
    rsiWeekly: entry.data.rsiWeekly,
    intradayRsi: entry.data.intradayRsi,
    macdCross: entry.data.macdCross,
    macdHistogram: entry.data.macdHistogram,
    volumeRatio: entry.data.volumeRatio,
    atrRatio: entry.data.marketContext.atrRatio,
    dailyReturnZScore: entry.data.marketContext.dailyReturnZScore,
    relativeStrength: entry.data.relativeStrength,
    signal: {
      score: entry.signal.score,
      label: entry.signal.label,
      factors: entry.signal.factors,
    },
    alerts: entry.alerts,
  }));

  await appendFile(logFile, `${lines.join("\n")}\n`, "utf-8");
}

async function runMonitorCycle(options: MonitorCycleOptions = {}): Promise<void> {
  const { forceRun = false } = options;

  if (!forceRun && CONFIG.alertDeliveryOnly && !isWithinAlertDeliveryWindow()) {
    console.log(
      `[${new Date().toLocaleString("ko-KR")}] 알림 허용 시간 외 (${CONFIG.alertDeliveryTimezone} ${CONFIG.alertDeliveryStartHour}:00~${CONFIG.alertDeliveryEndHour}:00) - 스킵`
    );
    return;
  }

  const marketState = await getMarketState();

  if (marketState === "CLOSED") {
    console.log(`[${new Date().toLocaleString("ko-KR")}] \uD734\uC7A5\uC77C - \uC54C\uB9BC \uBC0F \uBAA8\uB2C8\uD130\uB9C1 \uC2A4\uD0B5`);
    return;
  }

  if (CONFIG.marketHoursOnly && marketState !== "REGULAR") {
    console.log(
      `[${new Date().toLocaleString("ko-KR")}] \uC7A5\uC678 \uC2DC\uAC04 (${MARKET_STATE_LABEL[marketState] ?? marketState}) - \uC2A4\uD0B5`
    );
    return;
  }

  const stateStr = MARKET_STATE_LABEL[marketState] ?? marketState;
  console.log(`\n[${new Date().toLocaleString("ko-KR")}] \uBAA8\uB2C8\uD130\uB9C1 \uC0AC\uC774\uD074 \uC2DC\uC791 [${stateStr}]`);

  const entries: CycleEntry[] = [];

  for (const stock of STOCKS) {
    try {
      console.log(`  [${stock.ticker}] \uB370\uC774\uD130 \uC218\uC9D1 \uC911...`);
      const data = await fetchStockData(stock.ticker, marketState);
      const signal = analyzeSignal(stock, data);
      const { alerts, includeStrongSignal } = checkAlerts(stock, data, signal);

      const direction = formatDirection(data.dailyChangePercent);
      const zScoreLog = data.marketContext.dailyReturnZScore !== null ? data.marketContext.dailyReturnZScore.toFixed(1) : "N/A";
      const rsiLog = data.rsi !== null ? data.rsi.toFixed(1) : "N/A";
      const weeklyRsiLog = data.rsiWeekly !== null ? data.rsiWeekly.toFixed(1) : "N/A";
      const intradayRsiLog = data.intradayRsi !== null ? data.intradayRsi.toFixed(1) : "N/A";
      const intradayStateLog = formatIntradayRsiState(data.intradayRsi);

      console.log(`  * ${direction} [${stock.ticker}] ${stock.name} [${stateStr}]`);
      console.log(`  - \uAC00\uACA9: $${data.currentPrice.toFixed(2)} (${data.dailyChangePercent >= 0 ? "+" : ""}${data.dailyChangePercent.toFixed(2)}%)`);
      console.log(`  - \uC2E0\uD638: ${signal.label} (${signal.score > 0 ? "+" : ""}${signal.score})`);
      console.log(`  - RSI: ${data.intradayRsiInterval} ${intradayRsiLog} (${intradayStateLog}) | 일봉 ${rsiLog} | 주봉 ${weeklyRsiLog}`);
      console.log(`  - \uBCC0\uB3D9\uC131 z-score: ${zScoreLog}`);
      if (alerts.length > 0) {
        console.log(`  - \uC54C\uB9BC: ${summarizeAlerts(alerts).join(", ")}`);
      }

      entries.push({
        ticker: stock.ticker,
        name: stock.name,
        profile: stock.profile,
        price: data.currentPrice,
        dailyChangePercent: data.dailyChangePercent,
        signal,
        alerts,
        includeStrongSignal,
        prevSignalScore: prevSignalScores.get(stock.ticker) ?? null,
        prevFactors: prevSignalFactors.get(stock.ticker) ?? null,
        prevSentIntradayRsi: prevSentIntradayRsiValues.get(stock.ticker) ?? null,
        data,
      });
    } catch (err) {
      console.error(`  [${stock.ticker}] \uC624\uB958 \uBC1C\uC0DD:`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  for (const entry of entries) {
    prevSignalScores.set(entry.ticker, entry.signal.score);
    prevSignalFactors.set(entry.ticker, { ...entry.signal.factors });
  }

  const isPeriodicSummary =
    lastPeriodicSummaryAt === null ||
    Date.now() - lastPeriodicSummaryAt.getTime() >= PERIODIC_SUMMARY_INTERVAL_MS;

  const highlighted = entries
    .filter((entry) => {
      const scoreChanged = entry.prevSignalScore !== null && entry.prevSignalScore !== entry.signal.score;
      return (entry.alerts.length > 0 || entry.includeStrongSignal) || scoreChanged;
    })
    .sort((a, b) => b.signal.score - a.signal.score);

  const isFirstRun = lastPeriodicSummaryAt === null;

  if (highlighted.length === 0 && !isPeriodicSummary) return;

  if (isPeriodicSummary) lastPeriodicSummaryAt = new Date();

  const showAll = isFirstRun || (isPeriodicSummary && highlighted.length === 0);
  const summaryEntries = (showAll ? entries : highlighted)
    .slice()
    .sort((a, b) => b.signal.score - a.signal.score);

  const now = new Date().toLocaleString("ko-KR", { timeZone: CONFIG.alertDeliveryTimezone });
  const isPeriodicOnly = isPeriodicSummary && highlighted.length === 0;
  const headerLabel = isPeriodicOnly ? "\uC815\uAE30 \uC694\uC57D" : "\uBAA8\uB2C8\uD130\uB9C1 \uC54C\uB9BC";
  const headerEmoji = isPeriodicOnly ? "\uD83D\uDCCB" : "\uD83D\uDCE1";
  let msg = `${headerEmoji} <b>${headerLabel}</b>\n`;
  msg += `\uD83D\uDD50 ${now} \u2502 ${stateStr} \u2502 ${summaryEntries.length}\uC885\uBAA9\n`;
  msg += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;

  for (const entry of summaryEntries) {
    const signalEmoji = getSignalEmoji(entry.signal.label);
    const change = `${entry.dailyChangePercent >= 0 ? "+" : ""}${entry.dailyChangePercent.toFixed(2)}%`;
    const scoreChanged = entry.prevSignalScore !== null && entry.prevSignalScore !== entry.signal.score;
    const prevScoreStr = scoreChanged && entry.prevSignalScore !== null
      ? ` \u2190 ${entry.prevSignalScore > 0 ? "+" : ""}${entry.prevSignalScore}`
      : "";
    const changeIcon = scoreChanged ? " \uD83D\uDD04" : "";
    const sessionLabel = marketState !== "REGULAR" ? ` [${stateStr}]` : "";

    msg += `\n\n<b>${signalEmoji} ${entry.ticker} ${entry.name}</b>${sessionLabel}  $${entry.price.toFixed(2)} (${change})\n`;
    msg += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
    msg += `\uC2E0\uD638  ${entry.signal.emoji} ${entry.signal.label} (${entry.signal.score > 0 ? "+" : ""}${entry.signal.score}${prevScoreStr})${changeIcon}\n`;
    msg += `\uD329\uD130  ${formatFactorsWithDelta(entry.signal.factors, entry.prevFactors)}\n`;

    const rsiStr = entry.data.rsi !== null ? entry.data.rsi.toFixed(1) : "N/A";
    const weeklyRsiStr = entry.data.rsiWeekly !== null ? entry.data.rsiWeekly.toFixed(1) : "N/A";
    msg += `\n  \uD83D\uDCC8 ${entry.data.intradayRsiInterval}RSI ${formatIntradayRsiDelta(entry)} \u2502 \uC77C\uBD09${rsiStr} \u2502 \uC8FC\uBD09${weeklyRsiStr}\n`;

    const { events, warnings } = categorizeAlerts(entry.alerts);
    if (events.length > 0) {
      msg += `  \u26A1 ${events.join(" \u2502 ")}\n`;
    }
    if (warnings.length > 0) {
      msg += `  \uD83D\uDEA8 ${warnings.join(" \u2502 ")}\n`;
    }

    const extracted = extractDetails(entry.signal.details);
    if (extracted.trend.length > 0) {
      msg += `  \uD83D\uDCA1 ${extracted.trend.join(" \u2502 ")}\n`;
    }
    if (extracted.relative) {
      msg += `  \uD83C\uDFF7 ${extracted.relative}\n`;
    }
  }

  msg += `\n\n\u2501\u2501\u2501 \uC804\uCCB4 \uC2E0\uD638 \uC694\uC57D \u2501\u2501\u2501\n`;

  interface GroupEntry {
    scoreStr: string;
    score: number;
  }

  const groups = {
    strongBuy: { label: "\uAC15\uD55C \uB9E4\uC218", emoji: "\uD83D\uDFE2\uD83D\uDFE2", items: [] as GroupEntry[] },
    buy: { label: "\uB9E4\uC218", emoji: "\uD83D\uDFE2", items: [] as GroupEntry[] },
    neutral: { label: "\uC911\uB9BD", emoji: "\u26AA", items: [] as GroupEntry[] },
    sell: { label: "\uB9E4\uB3C4", emoji: "\uD83D\uDD34", items: [] as GroupEntry[] },
    strongSell: { label: "\uAC15\uD55C \uB9E4\uB3C4", emoji: "\uD83D\uDD34\uD83D\uDD34", items: [] as GroupEntry[] },
  };

  for (const entry of entries) {
    const sign = entry.signal.score > 0 ? "+" : "";
    const changeSign = entry.dailyChangePercent >= 0 ? "+" : "";
    const changed = entry.prevSignalScore !== null && entry.prevSignalScore !== entry.signal.score;
    const scoreStr = `${entry.ticker}(${sign}${entry.signal.score}, ${changeSign}${entry.dailyChangePercent.toFixed(2)}%)${changed ? " \uD83D\uDD04" : ""}`;
    const groupEntry: GroupEntry = { scoreStr, score: entry.signal.score };

    if (entry.signal.label === "\uAC15\uD55C \uB9E4\uC218") groups.strongBuy.items.push(groupEntry);
    else if (entry.signal.label === "\uB9E4\uC218") groups.buy.items.push(groupEntry);
    else if (entry.signal.label === "\uAC15\uD55C \uB9E4\uB3C4") groups.strongSell.items.push(groupEntry);
    else if (entry.signal.label === "\uB9E4\uB3C4") groups.sell.items.push(groupEntry);
    else groups.neutral.items.push(groupEntry);
  }

  for (const group of [groups.strongBuy, groups.buy, groups.neutral]) {
    group.items.sort((a, b) => b.score - a.score);
  }
  for (const group of [groups.sell, groups.strongSell]) {
    group.items.sort((a, b) => a.score - b.score);
  }
  for (const group of [groups.strongBuy, groups.buy, groups.neutral, groups.sell, groups.strongSell]) {
    if (group.items.length > 0) {
      msg += `${group.emoji} ${group.label}  ${group.items.map((item) => item.scoreStr).join(" ")}\n`;
    }
  }

  await sendMessage(msg);
  await appendAlertLogs(summaryEntries, marketState, headerLabel);

  for (const entry of summaryEntries) {
    if (entry.data.intradayRsi !== null) {
      prevSentIntradayRsiValues.set(entry.ticker, entry.data.intradayRsi);
    }
  }
}

async function main(): Promise<void> {
  console.log("====================================");
  console.log("  NASDAQ \uC8FC\uC2DD \uBAA8\uB2C8\uD130\uB9C1 \uC11C\uBC84 \uC2DC\uC791");
  console.log("====================================");
  console.log(`\uCD94\uC801 \uC885\uBAA9: ${STOCKS.map((stock) => stock.ticker).join(", ")}`);
  console.log(`\uCCB4\uD06C \uC8FC\uAE30: ${CONFIG.checkIntervalMinutes}\uBD84`);
  console.log(`\uC7A5\uC911 \uC81C\uD55C: ${CONFIG.marketHoursOnly ? "\uD65C\uC131" : "\uBE44\uD65C\uC131"}`);
  console.log(
    `\uC54C\uB9BC \uC2DC\uAC04 \uC81C\uD55C: ${CONFIG.alertDeliveryOnly ? `${CONFIG.alertDeliveryTimezone} ${CONFIG.alertDeliveryStartHour}:00~${CONFIG.alertDeliveryEndHour}:00` : "\uBE44\uD65C\uC131"}`
  );
  console.log(`\uB85C\uADF8 \uC800\uC7A5: ${path.resolve(CONFIG.alertLogDir, CONFIG.alertLogFile)}`);
  console.log("====================================\n");

  initTelegram();

  await runMonitorCycle({ forceRun: true });

  const cronExpression = `*/${CONFIG.checkIntervalMinutes} * * * *`;
  console.log(`\n\uD06C\uB860 \uC2A4\uCF00\uC904 \uB4F1\uB85D: ${cronExpression}`);

  cron.schedule(cronExpression, async () => {
    await runMonitorCycle();
  });

  console.log("\uBAA8\uB2C8\uD130\uB9C1 \uC11C\uBC84 \uC2E4\uD589 \uC911... (Ctrl+C \uB85C \uC885\uB8CC)\n");
}

main().catch((err) => {
  console.error("\uCE58\uBA85\uC801 \uC624\uB958:", err);
  process.exit(1);
});
