import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { STOCKS, CONFIG } from "./config.js";
import { fetchStockData, getMarketState, StockData } from "./indicators.js";
import { checkAlerts, analyzeSignal, SignalResult } from "./alertChecker.js";
import { initTelegram, sendMessage } from "./telegram.js";
import { buildAutoSummary } from "./summaryBuilder.js";

const PERIODIC_SUMMARY_INTERVAL_MS = 30 * 60 * 1000;
let lastPeriodicSummaryAt: Date | null = null;

const prevSignalScores = new Map<string, number>();
const prevSignalFactors = new Map<string, SignalResult["factors"]>();
const prevSentIntradayRsiValues = new Map<string, number>();

const MARKET_STATE_LABEL: Record<string, string> = {
  REGULAR: "정규장",
  PRE: "프리마켓",
  PREPRE: "프리마켓",
  POST: "애프터마켓",
  POSTPOST: "애프터마켓",
  CLOSED: "휴장",
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
  if (change > 0) return "▲";
  if (change < 0) return "▼";
  return "■";
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

function formatFactorsWithDelta(
  factors: SignalResult["factors"],
  prevFactors: SignalResult["factors"] | null
): string {
  const names: [keyof SignalResult["factors"], string][] = [
    ["trend", "추세"],
    ["momentum", "모멘텀"],
    ["volatility", "변동성"],
    ["flow", "수급"],
    ["relative", "상대"],
  ];
  return names.map(([key, label]) => {
    const curr = factors[key];
    const sign = curr > 0 ? "+" : "";
    let arrow = "";
    if (prevFactors && curr !== prevFactors[key]) {
      arrow = curr > prevFactors[key] ? "⬆" : "⬇";
    }
    return `${label}${sign}${curr}${arrow}`;
  }).join(" ");
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

// ─── 메시지 빌더 ───────────────────────────────────────────────

function buildHeader(now: string, stateStr: string, isPeriodicOnly: boolean): string {
  const headerLabel = isPeriodicOnly ? "정기 요약" : "모니터링 알림";
  const headerEmoji = isPeriodicOnly ? "📋" : "📡";
  return `${headerEmoji} <b>${headerLabel}</b>  ${now} │ ${stateStr}`;
}

function buildSignalLine(alerts: string[]): string {
  if (alerts.length === 0) return "";

  const criticalPrefixes = ["[변동성]", "[가격]"];
  const warningPrefixes = ["[RSI]", "[주봉 RSI]", "[볼린저]", "[거래량]", "[ATR]"];

  let priorityEmoji = "ℹ️";
  for (const alert of alerts) {
    if (criticalPrefixes.some((p) => alert.startsWith(p))) {
      priorityEmoji = "🚨";
      break;
    }
    if (warningPrefixes.some((p) => alert.startsWith(p))) {
      priorityEmoji = "⚠️";
    }
  }

  const labels = alerts.slice(0, 3).map((alert) => {
    return alert
      .replace(/^\[[^\]]+\]\s*/, "")
      .replace(/<b>/g, "")
      .replace(/<\/b>/g, "")
      .replace(/\s*\(.*?\)\s*$/, "")
      .trim();
  });

  return `└ ${priorityEmoji} ${labels.join(" / ")}`;
}

function buildJudgmentCheck(entry: CycleEntry): string {
  const lines: string[] = [];

  const { ma50, ma200, volumeRatio } = entry.data;

  if (ma50 !== null && ma200 !== null) {
    const ma50Status = entry.price > ma50 ? "MA50 상회" : "MA50 하회";
    const ma200Status = entry.price > ma200 ? "MA200 상회" : "MA200 하회";
    const alignment = ma50 > ma200 ? "정배열" : "역배열";
    lines.push(`- 추세: ${ma50Status}, ${ma200Status} (${alignment})`);
  } else if (ma50 !== null) {
    lines.push(`- 추세: ${entry.price > ma50 ? "MA50 상회" : "MA50 하회"}`);
  } else {
    lines.push("- 추세: 데이터 없음");
  }

  if (volumeRatio !== null) {
    const strength = volumeRatio >= 1.5 ? "강함" : volumeRatio >= 0.9 ? "보통" : "약함";
    lines.push(`- 수급: 거래량 ${volumeRatio.toFixed(1)}배로 ${strength}`);
  } else {
    lines.push("- 수급: 데이터 없음");
  }

  lines.push("- 이벤트: 없음");

  return `<b>판단 체크</b>\n${lines.join("\n")}`;
}

function isFullVersion(entry: CycleEntry): boolean {
  return Math.abs(entry.signal.score) >= 3 || entry.alerts.length > 0;
}

function buildStockBlock(entry: CycleEntry, sessionLabel: string): string {
  const change = `${entry.dailyChangePercent >= 0 ? "+" : ""}${entry.dailyChangePercent.toFixed(2)}%`;
  const priceStr = `$${entry.price.toFixed(2)} (${change})`;
  const full = isFullVersion(entry);

  const scoreChanged = entry.prevSignalScore !== null && entry.prevSignalScore !== entry.signal.score;
  const changeIcon = scoreChanged ? " 🔄" : "";
  const sessionPart = sessionLabel ? `  ${sessionLabel}` : "";

  let block = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  block += `${entry.signal.emoji} <b>${entry.ticker}</b>${sessionPart}  ${priceStr}${changeIcon}\n`;

  if (full) {
    const signalLine = buildSignalLine(entry.alerts);
    if (signalLine) {
      block += `${signalLine}\n`;
    }
    const summary = buildAutoSummary(entry.data, entry.signal);
    block += `요약: ${summary}\n`;
    block += `\n${buildJudgmentCheck(entry)}\n`;
  } else {
    const summary = buildAutoSummary(entry.data, entry.signal);
    block += `└ 요약: ${summary}\n`;
  }

  return block;
}

function buildSummaryFooter(allEntries: CycleEntry[]): string {
  const sorted = [...allEntries].sort((a, b) => {
    const absDiff = Math.abs(b.signal.score) - Math.abs(a.signal.score);
    if (absDiff !== 0) return absDiff;
    return a.ticker.localeCompare(b.ticker);
  });

  const parts = sorted.map((entry) => {
    const sign = entry.signal.score > 0 ? "+" : "";
    const changeSign = entry.dailyChangePercent >= 0 ? "+" : "";
    return `${entry.signal.emoji} ${entry.ticker}(${sign}${entry.signal.score}, ${changeSign}${entry.dailyChangePercent.toFixed(2)}%)`;
  });

  return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n전체 신호  ${parts.join("  ")}`;
}

// ────────────────────────────────────────────────────────────────

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
    console.log(`[${new Date().toLocaleString("ko-KR")}] 휴장일 - 알림 및 모니터링 스킵`);
    return;
  }

  if (CONFIG.marketHoursOnly && marketState !== "REGULAR") {
    console.log(
      `[${new Date().toLocaleString("ko-KR")}] 장외 시간 (${MARKET_STATE_LABEL[marketState] ?? marketState}) - 스킵`
    );
    return;
  }

  const stateStr = MARKET_STATE_LABEL[marketState] ?? marketState;
  console.log(`\n[${new Date().toLocaleString("ko-KR")}] 모니터링 사이클 시작 [${stateStr}]`);

  const entries: CycleEntry[] = [];

  for (const stock of STOCKS) {
    try {
      console.log(`  [${stock.ticker}] 데이터 수집 중...`);
      const data = await fetchStockData(stock.ticker, marketState);
      const signal = analyzeSignal(stock, data);
      const { alerts, includeStrongSignal } = checkAlerts(stock, data, signal);

      const direction = formatDirection(data.dailyChangePercent);
      const zScoreLog = data.marketContext.dailyReturnZScore !== null ? data.marketContext.dailyReturnZScore.toFixed(1) : "N/A";
      const rsiLog = data.rsi !== null ? data.rsi.toFixed(1) : "N/A";
      const weeklyRsiLog = data.rsiWeekly !== null ? data.rsiWeekly.toFixed(1) : "N/A";
      const intradayRsiLog = data.intradayRsi !== null ? data.intradayRsi.toFixed(1) : "N/A";
      const intradayStateLog = formatIntradayRsiState(data.intradayRsi);
      const prevScore = prevSignalScores.get(stock.ticker) ?? null;
      const prevFactorsVal = prevSignalFactors.get(stock.ticker) ?? null;

      console.log(`  * ${direction} [${stock.ticker}] ${stock.name} [${stateStr}]`);
      console.log(`  - 가격: $${data.currentPrice.toFixed(2)} (${data.dailyChangePercent >= 0 ? "+" : ""}${data.dailyChangePercent.toFixed(2)}%)`);
      console.log(`  - 신호: ${signal.label} (${signal.score > 0 ? "+" : ""}${signal.score})`);
      console.log(`  - 팩터: ${formatFactorsWithDelta(signal.factors, prevFactorsVal)}`);
      console.log(`  - RSI: ${data.intradayRsiInterval} ${intradayRsiLog} (${intradayStateLog}) | 일봉 ${rsiLog} | 주봉 ${weeklyRsiLog}`);
      console.log(`  - 변동성 z-score: ${zScoreLog}`);
      if (alerts.length > 0) {
        console.log(`  - 알림: ${summarizeAlerts(alerts).join(", ")}`);
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
        prevSignalScore: prevScore,
        prevFactors: prevFactorsVal,
        prevSentIntradayRsi: prevSentIntradayRsiValues.get(stock.ticker) ?? null,
        data,
      });
    } catch (err) {
      console.error(`  [${stock.ticker}] 오류 발생:`, err);
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
    .sort((a, b) => Math.abs(b.signal.score) - Math.abs(a.signal.score));

  const isFirstRun = lastPeriodicSummaryAt === null;

  if (highlighted.length === 0 && !isPeriodicSummary) return;

  if (isPeriodicSummary) lastPeriodicSummaryAt = new Date();

  const showAll = isFirstRun || (isPeriodicSummary && highlighted.length === 0);
  const summaryEntries = (showAll ? entries : highlighted)
    .slice()
    .sort((a, b) => Math.abs(b.signal.score) - Math.abs(a.signal.score));

  const now = new Date().toLocaleString("ko-KR", {
    timeZone: CONFIG.alertDeliveryTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const isPeriodicOnly = isPeriodicSummary && highlighted.length === 0;
  const sessionLabel = marketState !== "REGULAR" ? `[${stateStr}]` : "";

  let msg = buildHeader(now, stateStr, isPeriodicOnly);

  for (const entry of summaryEntries) {
    msg += buildStockBlock(entry, sessionLabel);
  }

  msg += buildSummaryFooter(entries);

  await sendMessage(msg);
  await appendAlertLogs(summaryEntries, marketState, isPeriodicOnly ? "정기 요약" : "모니터링 알림");

  for (const entry of summaryEntries) {
    if (entry.data.intradayRsi !== null) {
      prevSentIntradayRsiValues.set(entry.ticker, entry.data.intradayRsi);
    }
  }
}

async function main(): Promise<void> {
  console.log("====================================");
  console.log("  NASDAQ 주식 모니터링 서버 시작");
  console.log("====================================");
  console.log(`추적 종목: ${STOCKS.map((stock) => stock.ticker).join(", ")}`);
  console.log(`체크 주기: ${CONFIG.checkIntervalMinutes}분`);
  console.log(`장중 제한: ${CONFIG.marketHoursOnly ? "활성" : "비활성"}`);
  console.log(
    `알림 시간 제한: ${CONFIG.alertDeliveryOnly ? `${CONFIG.alertDeliveryTimezone} ${CONFIG.alertDeliveryStartHour}:00~${CONFIG.alertDeliveryEndHour}:00` : "비활성"}`
  );
  console.log(`로그 저장: ${path.resolve(CONFIG.alertLogDir, CONFIG.alertLogFile)}`);
  console.log("====================================\n");

  initTelegram();

  await runMonitorCycle({ forceRun: true });

  const cronExpression = `*/${CONFIG.checkIntervalMinutes} * * * *`;
  console.log(`\n크론 스케줄 등록: ${cronExpression}`);

  cron.schedule(cronExpression, async () => {
    await runMonitorCycle();
  });

  console.log("모니터링 서버 실행 중... (Ctrl+C 로 종료)\n");
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
