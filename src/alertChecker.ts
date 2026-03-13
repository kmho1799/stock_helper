import { StockConfig } from "./config.js";
import { StockData } from "./indicators.js";

const alertCooldowns = new Map<string, Date>();
const COOLDOWN_MS = 60 * 60 * 1000;
const SIGNAL_COOLDOWN_MS = 4 * 60 * 60 * 1000;

function isOnCooldown(key: string): boolean {
  const last = alertCooldowns.get(key);
  if (!last) return false;
  return Date.now() - last.getTime() < COOLDOWN_MS;
}

function setCooldown(key: string): void {
  alertCooldowns.set(key, new Date());
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function formatPercent(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatRsi(rsi: number): string {
  return rsi.toFixed(1);
}

function clampFactor(value: number): number {
  return Math.max(-2, Math.min(2, value));
}

function formatFactor(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function translateSectorName(sector: string | null | undefined): string {
  const map: Record<string, string> = {
    Technology: "기술",
    Healthcare: "헬스케어",
    "Financial Services": "금융 서비스",
    Financials: "금융",
    "Consumer Cyclical": "경기소비재",
    "Consumer Defensive": "필수소비재",
    Energy: "에너지",
    Industrials: "산업재",
    "Basic Materials": "소재",
    "Real Estate": "부동산",
    "Communication Services": "커뮤니케이션 서비스",
    Utilities: "유틸리티",
  };
  if (!sector) return "섹터";
  return map[sector] ?? sector;
}

export interface SignalResult {
  score: number;
  label: "강한 매수" | "매수" | "중립" | "매도" | "강한 매도";
  emoji: string;
  details: string[];
  factors: {
    trend: number;
    momentum: number;
    volatility: number;
    flow: number;
    relative: number;
  };
}

export interface AlertCheckResult {
  alerts: string[];
  includeStrongSignal: boolean;
}

export function analyzeSignal(data: StockData): SignalResult {
  const details: string[] = [];

  let trend = 0;
  if (data.ma50 !== null) {
    trend += data.currentPrice > data.ma50 ? 1 : -1;
    details.push(`추세: 현재가 ${data.currentPrice > data.ma50 ? "MA50 상회" : "MA50 하회"}`);
  }
  if (data.ma50 !== null && data.ma200 !== null) {
    trend += data.ma50 > data.ma200 ? 1 : -1;
    details.push(`추세: ${data.ma50 > data.ma200 ? "중장기 정배열" : "중장기 역배열"}`);
  }
  trend = clampFactor(trend);

  let momentum = 0;
  if (data.rsi !== null) {
    if (data.rsi < 30) momentum += 1;
    else if (data.rsi >= 45 && data.rsi <= 65) momentum += 1;
    else if (data.rsi > 75) momentum -= 2;
    else if (data.rsi < 40) momentum -= 1;
  }
  if (data.rsiWeekly !== null) {
    if (data.rsiWeekly < 40) momentum += 1;
    else if (data.rsiWeekly > 65) momentum -= 1;
  }
  if (data.macdHistogram !== null) {
    momentum += data.macdHistogram > 0 ? 1 : -1;
  }
  if (data.macdCross === "bullish") momentum += 1;
  else if (data.macdCross === "bearish") momentum -= 1;
  momentum = clampFactor(momentum);
  details.push(`모멘텀: RSI ${data.rsi !== null ? data.rsi.toFixed(1) : "N/A"}, MACD ${data.macdHistogram !== null ? data.macdHistogram.toFixed(3) : "N/A"}`);

  let volatility = 0;
  if (data.bollinger !== null) {
    if (data.currentPrice <= data.bollinger.lower) volatility += 2;
    else if (data.currentPrice < data.bollinger.middle) volatility += 1;
    else if (data.currentPrice >= data.bollinger.upper) volatility -= 2;
    else if (data.currentPrice > data.bollinger.middle) volatility -= 1;
  }
  if (data.atr !== null && data.avgAtr !== null && data.avgAtr > 0) {
    const atrRatio = data.atr / data.avgAtr;
    if (atrRatio >= 2) volatility -= 1;
    else if (atrRatio <= 0.8) volatility += 1;
  }
  volatility = clampFactor(volatility);

  let flow = 0;
  if (data.volumeRatio !== null) {
    if (data.volumeRatio >= 1.5) {
      flow += 1;
      details.push(`수급: 거래량 평균 대비 ${data.volumeRatio.toFixed(1)}배`);
    } else if (data.volumeRatio <= 0.8) {
      flow -= 1;
    }
  }
  if (data.volumeSpike) flow += trend >= 0 ? 1 : -1;
  flow = clampFactor(flow);

  let relative = 0;
  if (data.relativeStrength) {
    const { diff3m, diff6m, diff1y, sector } = data.relativeStrength;
    if (diff3m !== null) {
      if (diff3m >= 5) relative += 1;
      else if (diff3m <= -5) relative -= 1;
    }
    if (diff6m !== null) {
      if (diff6m >= 5) relative += 1;
      else if (diff6m <= -5) relative -= 1;
    }
    if (diff1y !== null) {
      if (diff1y >= 10) relative += 1;
      else if (diff1y <= -10) relative -= 1;
    }
    details.push(
      `상대강도: ${translateSectorName(sector)} 섹터 대비 3개월 ${diff3m !== null ? formatPercent(diff3m) + 'p' : 'N/A'}, 6개월 ${diff6m !== null ? formatPercent(diff6m) + 'p' : 'N/A'}, 1년 ${diff1y !== null ? formatPercent(diff1y) + 'p' : 'N/A'}`
    );
  }
  relative = clampFactor(relative);

  const score = trend + momentum + volatility + flow + relative;

  let label: SignalResult["label"];
  let emoji: string;
  if (score >= 6) {
    label = "강한 매수";
    emoji = "🟢";
  } else if (score >= 2) {
    label = "매수";
    emoji = "🟡";
  } else if (score <= -6) {
    label = "강한 매도";
    emoji = "🔴";
  } else if (score <= -2) {
    label = "매도";
    emoji = "🟠";
  } else {
    label = "중립";
    emoji = "⚪";
  }

  details.unshift(
    `팩터 점수 | 추세 ${formatFactor(trend)}, 모멘텀 ${formatFactor(momentum)}, 변동성 ${formatFactor(volatility)}, 수급 ${formatFactor(flow)}, 상대강도 ${formatFactor(relative)}`
  );

  return {
    score,
    label,
    emoji,
    details,
    factors: { trend, momentum, volatility, flow, relative },
  };
}

export function checkAlerts(stock: StockConfig, data: StockData, signal: SignalResult): AlertCheckResult {
  const { ticker, alerts } = stock;
  const alertsList: string[] = [];

  if (alerts.macdCrossAlert && data.macdCross !== null) {
    if (data.macdCross === "bullish") {
      const key = `${ticker}_MACD_BULLISH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`📈 <b>MACD 골든크로스</b> (히스토그램 ${data.macdHistogram?.toFixed(3) ?? "N/A"})`);
        setCooldown(key);
      }
    } else if (data.macdCross === "bearish") {
      const key = `${ticker}_MACD_BEARISH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`📉 <b>MACD 데드크로스</b> (히스토그램 ${data.macdHistogram?.toFixed(3) ?? "N/A"})`);
        setCooldown(key);
      }
    }
  }

  if (alerts.bollingerAlert && data.bollinger !== null) {
    if (data.currentPrice >= data.bollinger.upper) {
      const key = `${ticker}_BB_UPPER`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🚨 <b>볼린저 상단 돌파</b> (현재가 ${formatPrice(data.currentPrice)} / 상단 ${formatPrice(data.bollinger.upper)})`);
        setCooldown(key);
      }
    } else if (data.currentPrice <= data.bollinger.lower) {
      const key = `${ticker}_BB_LOWER`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🛟 <b>볼린저 하단 이탈</b> (현재가 ${formatPrice(data.currentPrice)} / 하단 ${formatPrice(data.bollinger.lower)})`);
        setCooldown(key);
      }
    }
  }

  if (alerts.maCrossAlert && data.maCross !== null) {
    if (data.maCross === "golden") {
      const key = `${ticker}_MA_GOLDEN`;
      if (!isOnCooldown(key)) {
        alertsList.push(`✨ <b>골든크로스</b> MA50(${formatPrice(data.ma50 ?? 0)}) > MA200(${formatPrice(data.ma200 ?? 0)})`);
        setCooldown(key);
      }
    } else if (data.maCross === "death") {
      const key = `${ticker}_MA_DEATH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`⚠️ <b>데드크로스</b> MA50(${formatPrice(data.ma50 ?? 0)}) < MA200(${formatPrice(data.ma200 ?? 0)})`);
        setCooldown(key);
      }
    }
  }

  if (alerts.stochasticAlert && data.stochasticSignal !== null && data.stochastic !== null) {
    if (data.stochasticSignal === "oversold") {
      const key = `${ticker}_STOCH_OVERSOLD`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🟡 <b>스토캐스틱 과매도</b> (%K ${data.stochastic.k.toFixed(1)})`);
        setCooldown(key);
      }
    } else if (data.stochasticSignal === "overbought") {
      const key = `${ticker}_STOCH_OVERBOUGHT`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🟠 <b>스토캐스틱 과매수</b> (%K ${data.stochastic.k.toFixed(1)})`);
        setCooldown(key);
      }
    }
  }

  if (alerts.volumeSpikeAlert && data.volumeSpike && data.volume !== null && data.avgVolume !== null) {
    const key = `${ticker}_VOLUME_SPIKE`;
    if (!isOnCooldown(key)) {
      const ratio = (data.volume / data.avgVolume).toFixed(1);
      alertsList.push(`📊 <b>거래량 급증</b> (평균 대비 ${ratio}배)`);
      setCooldown(key);
    }
  }

  if (alerts.atrSpikeAlert && data.atr !== null && data.avgAtr !== null && data.atr >= data.avgAtr * 2) {
    const key = `${ticker}_ATR_SPIKE`;
    if (!isOnCooldown(key)) {
      const ratio = (data.atr / data.avgAtr).toFixed(1);
      alertsList.push(`🌪️ <b>ATR 급등</b> (현재 ${data.atr.toFixed(2)} / 평균 대비 ${ratio}배)`);
      setCooldown(key);
    }
  }

  if (data.rsiWeekly !== null && alerts.rsiWeeklyOversold !== null && data.rsiWeekly <= alerts.rsiWeeklyOversold) {
    const key = `${ticker}_RSI_WEEKLY_OVERSOLD`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🟡 <b>주봉 RSI 과매도</b> (${formatRsi(data.rsiWeekly)} <= ${alerts.rsiWeeklyOversold})`);
      setCooldown(key);
    }
  }
  if (data.rsiWeekly !== null && alerts.rsiWeeklyOverbought !== null && data.rsiWeekly >= alerts.rsiWeeklyOverbought) {
    const key = `${ticker}_RSI_WEEKLY_OVERBOUGHT`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🟠 <b>주봉 RSI 과매수</b> (${formatRsi(data.rsiWeekly)} >= ${alerts.rsiWeeklyOverbought})`);
      setCooldown(key);
    }
  }

  if (data.rsi !== null && data.rsi <= alerts.rsiOversold) {
    const key = `${ticker}_RSI_OVERSOLD`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🟡 <b>RSI 과매도</b> (${formatRsi(data.rsi)} <= ${alerts.rsiOversold})`);
      setCooldown(key);
    }
  }
  if (data.rsi !== null && data.rsi >= alerts.rsiOverbought) {
    const key = `${ticker}_RSI_OVERBOUGHT`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🟠 <b>RSI 과매수</b> (${formatRsi(data.rsi)} >= ${alerts.rsiOverbought})`);
      setCooldown(key);
    }
  }

  if (alerts.priceBelowAlert !== null && data.currentPrice <= alerts.priceBelowAlert) {
    const key = `${ticker}_PRICE_BELOW`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🔻 <b>가격 하단 돌파</b> (${formatPrice(data.currentPrice)} <= ${formatPrice(alerts.priceBelowAlert)})`);
      setCooldown(key);
    }
  }
  if (alerts.priceAboveAlert !== null && data.currentPrice >= alerts.priceAboveAlert) {
    const key = `${ticker}_PRICE_ABOVE`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🔺 <b>가격 상단 돌파</b> (${formatPrice(data.currentPrice)} >= ${formatPrice(alerts.priceAboveAlert)})`);
      setCooldown(key);
    }
  }

  if (alerts.dailyChangePercent !== null && data.dailyChangePercent <= alerts.dailyChangePercent) {
    const key = `${ticker}_DAILY_DOWN`;
    if (!isOnCooldown(key)) {
      alertsList.push(`📉 <b>급락 감지</b> (${formatPercent(data.dailyChangePercent)})`);
      setCooldown(key);
    }
  }
  if (alerts.dailyChangePercentUp !== null && data.dailyChangePercent >= alerts.dailyChangePercentUp) {
    const key = `${ticker}_DAILY_UP`;
    if (!isOnCooldown(key)) {
      alertsList.push(`📈 <b>급등 감지</b> (${formatPercent(data.dailyChangePercent)})`);
      setCooldown(key);
    }
  }

  let includeStrongSignal = false;
  if (Math.abs(signal.score) >= 5) {
    const signalKey = `${ticker}_SIGNAL_${signal.label}`;
    const lastSignal = alertCooldowns.get(signalKey);
    if (!lastSignal || Date.now() - lastSignal.getTime() >= SIGNAL_COOLDOWN_MS) {
      includeStrongSignal = true;
      alertCooldowns.set(signalKey, new Date());
    }
  }

  return { alerts: alertsList, includeStrongSignal };
}
