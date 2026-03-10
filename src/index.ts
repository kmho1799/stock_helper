import cron from "node-cron";
import { STOCKS, CONFIG } from "./config.js";
import { fetchStockData, getMarketState } from "./indicators.js";
import { checkAlerts, analyzeSignal, SignalResult } from "./alertChecker.js";
import { initTelegram, sendMessage } from "./telegram.js";

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
  price: number;
  dailyChangePercent: number;
  signal: SignalResult;
  alerts: string[];
  includeStrongSignal: boolean;
}

async function runMonitorCycle(): Promise<void> {
  const marketState = await getMarketState();

  if (CONFIG.marketHoursOnly && marketState !== "REGULAR") {
    console.log(
      `[${new Date().toLocaleString("ko-KR")}] 장 시간 외 (${
        MARKET_STATE_LABEL[marketState] ?? marketState
      }) - 스킵`
    );
    return;
  }

  const stateStr = MARKET_STATE_LABEL[marketState] ?? marketState;
  console.log(
    `\n[${new Date().toLocaleString(
      "ko-KR"
    )}] 모니터링 사이클 시작 [${stateStr}]`
  );

  const entries: CycleEntry[] = [];

  for (const stock of STOCKS) {
    try {
      console.log(`  [${stock.ticker}] 데이터 수집 중...`);
      const data = await fetchStockData(stock.ticker, marketState);

      const sign = data.dailyChangePercent >= 0 ? "+" : "";
      const rsi = data.rsi !== null ? data.rsi.toFixed(1) : "N/A";
      const rsiW = data.rsiWeekly !== null ? data.rsiWeekly.toFixed(1) : "N/A";
      const bb = data.bollinger
        ? `$${data.bollinger.lower.toFixed(2)}~$${data.bollinger.upper.toFixed(
            2
          )}`
        : "N/A";
      const ma =
        data.ma50 !== null && data.ma200 !== null
          ? `$${data.ma50.toFixed(2)} / $${data.ma200.toFixed(2)}`
          : "N/A";
      const macd =
        data.macdHistogram !== null
          ? `${data.macdHistogram.toFixed(3)}${
              data.macdCross
                ? ` [${data.macdCross === "bullish" ? "↑골든" : "↓데드"}]`
                : ""
            }`
          : "N/A";
      const maCrossLog = data.maCross
        ? ` [${data.maCross === "golden" ? "✨골든크로스" : "💀데스크로스"}]`
        : "";
      const stoch = data.stochastic
        ? `%K ${data.stochastic.k.toFixed(1)} / %D ${data.stochastic.d.toFixed(
            1
          )}${
            data.stochasticSignal
              ? ` [${
                  data.stochasticSignal === "oversold" ? "과매도" : "과매수"
                }]`
              : ""
          }`
        : "N/A";
      const atrLog = data.atr !== null ? `$${data.atr.toFixed(2)}` : "N/A";
      const volLog =
        data.volume !== null && data.avgVolume !== null
          ? `${(data.volume / 1_000_000).toFixed(2)}M (평균 ${(
              data.avgVolume / 1_000_000
            ).toFixed(2)}M)${data.volumeSpike ? " [🔥급등]" : ""}`
          : "N/A";

      const signal = analyzeSignal(data);
      const { alerts, includeStrongSignal } = checkAlerts(stock, data, signal);

      console.log(`  ┌─ [${stock.ticker}] ${stock.name} [${stateStr}]`);
      console.log(
        `  │  가격: $${data.currentPrice.toFixed(
          2
        )} | 일간: ${sign}${data.dailyChangePercent.toFixed(2)}%`
      );
      console.log(`  │  RSI(일봉): ${rsi} | RSI(주봉): ${rsiW}`);
      console.log(`  │  MACD 히스토그램: ${macd}`);
      console.log(`  │  볼린저 밴드: ${bb}`);
      console.log(`  │  MA50/MA200: ${ma}${maCrossLog}`);
      console.log(`  │  스토캐스틱: ${stoch}`);
      console.log(`  │  ATR(14): ${atrLog}`);
      console.log(`  │  거래량: ${volLog}`);
      console.log(
        `  └─ 종합신호: ${signal.emoji} ${signal.label} (${
          signal.score > 0 ? "+" : ""
        }${signal.score}점)`
      );

      entries.push({
        ticker: stock.ticker,
        name: stock.name,
        price: data.currentPrice,
        dailyChangePercent: data.dailyChangePercent,
        signal,
        alerts,
        includeStrongSignal,
      });
    } catch (err) {
      console.error(`  [${stock.ticker}] 오류 발생:`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 알림이 있는 항목만 추출 (개별 알림 또는 강한 신호)
  const highlighted = entries.filter(
    (e) => e.alerts.length > 0 || e.includeStrongSignal
  );
  if (highlighted.length === 0) return;

  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  let msg = `🔔 <b>모니터링 알림</b> | ${now}\n━━━━━━━━━━━━━━━\n`;

  for (const e of highlighted) {
    const change =
      e.dailyChangePercent >= 0
        ? `+${e.dailyChangePercent.toFixed(2)}%`
        : `${e.dailyChangePercent.toFixed(2)}%`;

    const sessionLabel = marketState !== "REGULAR" ? ` [${stateStr}]` : "";
    msg += `\n${e.signal.emoji} <b>[${e.ticker}] ${
      e.name
    }</b>${sessionLabel}  $${e.price.toFixed(2)} (${change})\n`;
    msg += `종합신호: <b>${e.signal.label}</b> (${
      e.signal.score > 0 ? "+" : ""
    }${e.signal.score}점)\n`;

    if (e.includeStrongSignal) {
      msg += e.signal.details.map((d) => `  • ${d}`).join("\n") + "\n";
    }

    if (e.alerts.length > 0) {
      msg += e.alerts.map((a) => `  ${a}`).join("\n") + "\n";
    }
  }

  // 전체 신호 요약
  msg += `\n━━━━━━━━━━━━━━━\n📋 <b>전체 신호 요약</b>\n`;
  const groups: Record<string, string[]> = {
    "🟢 강한 매수": [],
    "🔵 매수": [],
    "⚪ 중립": [],
    "🟡 매도": [],
    "🔴 강한 매도": [],
  };
  for (const e of entries) {
    const scoreStr = `${e.ticker}(${e.signal.score > 0 ? "+" : ""}${
      e.signal.score
    })`;
    if (e.signal.score >= 5) groups["🟢 강한 매수"].push(scoreStr);
    else if (e.signal.score >= 2) groups["🔵 매수"].push(scoreStr);
    else if (e.signal.score <= -5) groups["🔴 강한 매도"].push(scoreStr);
    else if (e.signal.score <= -2) groups["🟡 매도"].push(scoreStr);
    else groups["⚪ 중립"].push(scoreStr);
  }
  for (const [label, tickers] of Object.entries(groups)) {
    if (tickers.length > 0) msg += `${label}: ${tickers.join(", ")}\n`;
  }

  await sendMessage(msg);
}

async function main(): Promise<void> {
  console.log("====================================");
  console.log("  NASDAQ 주식 모니터링 서버 시작");
  console.log("====================================");
  console.log(`추적 종목: ${STOCKS.map((s) => s.ticker).join(", ")}`);
  console.log(`체크 주기: ${CONFIG.checkIntervalMinutes}분`);
  console.log(`장 시간 제한: ${CONFIG.marketHoursOnly ? "활성" : "비활성"}`);
  console.log("====================================\n");

  initTelegram();

  // 시작 시 즉시 1회 실행
  await runMonitorCycle();

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
