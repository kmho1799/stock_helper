import { SignalProfile, StockConfig } from "./config.js";
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
    Technology: "\uAE30\uC220",
    Healthcare: "\uD5EC\uC2A4\uCF00\uC5B4",
    "Financial Services": "\uAE08\uC735 \uC11C\uBE44\uC2A4",
    Financials: "\uAE08\uC735",
    "Consumer Cyclical": "\uACBD\uAE30\uC18C\uBE44\uC7AC",
    "Consumer Defensive": "\uD544\uC218\uC18C\uBE44\uC7AC",
    Energy: "\uC5D0\uB108\uC9C0",
    Industrials: "\uC0B0\uC5C5\uC7AC",
    "Basic Materials": "\uC18C\uC7AC",
    "Real Estate": "\uBD80\uB3D9\uC0B0",
    "Communication Services": "\uCEE4\uBBA4\uB2C8\uCF00\uC774\uC158 \uC11C\uBE44\uC2A4",
    Utilities: "\uC720\uD2F8\uB9AC\uD2F0",
  };
  if (!sector) return "\uC139\uD130";
  return map[sector] ?? sector;
}

function formatRsiAnalysis(rsi: number | null): string {
  if (rsi === null) return "N/A";
  if (rsi < 30) return `${rsi.toFixed(1)} \uACFC\uB9E4\uB3C4`;
  if (rsi > 70) return `${rsi.toFixed(1)} \uACFC\uB9E4\uC218`;
  if (rsi < 40) return `${rsi.toFixed(1)} \uC57D\uC138`;
  if (rsi > 60) return `${rsi.toFixed(1)} \uAC15\uC138`;
  return `${rsi.toFixed(1)} \uC911\uB9BD`;
}

function formatRsiBand(rsi: number | null, rules: SignalProfile["rsi"]): string {
  if (rsi === null) return "N/A";
  if (rsi <= rules.oversoldReboundMax) return `${rsi.toFixed(1)} \uACFC\uB9E4\uB3C4`;
  if (rsi < rules.weakTrendMax) return `${rsi.toFixed(1)} \uC57D\uC138`;
  if (rsi >= rules.bullishMin && rsi <= rules.bullishMax) return `${rsi.toFixed(1)} \uAC15\uC138 \uC5C6\uC774 \uC548\uC815`;
  if (rsi >= rules.overboughtMin) return `${rsi.toFixed(1)} \uACFC\uB9E4\uC218`;
  return `${rsi.toFixed(1)} \uC911\uB9BD`;
}

function formatStage(value: number, warning: number, critical: number, direction: "low" | "high"): string {
  if (direction === "low") {
    if (value <= critical) return "\uAC15\uD55C \uACBD\uACE0";
    if (value <= warning) return "\uACBD\uACE0";
    return "\uAD00\uC2EC";
  }
  if (value >= critical) return "\uAC15\uD55C \uACBD\uACE0";
  if (value >= warning) return "\uACBD\uACE0";
  return "\uAD00\uC2EC";
}

export interface SignalResult {
  score: number;
  label: "\uAC15\uD55C \uB9E4\uC218" | "\uB9E4\uC218" | "\uC911\uB9BD" | "\uB9E4\uB3C4" | "\uAC15\uD55C \uB9E4\uB3C4";
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

export function analyzeSignal(stock: StockConfig, data: StockData): SignalResult {
  const details: string[] = [];
  const { signal: rules } = stock;

  let trend = 0;
  if (data.ma50 !== null) {
    trend += data.currentPrice > data.ma50 ? 1 : -1;
    details.push(`\uCD94\uC138: \uD604\uC7AC\uAC00 ${data.currentPrice > data.ma50 ? "MA50 \uC0C1\uD68C" : "MA50 \uD558\uD68C"}`);
  }
  if (data.ma50 !== null && data.ma200 !== null) {
    trend += data.ma50 > data.ma200 ? 1 : -1;
    details.push(`\uCD94\uC138: ${data.ma50 > data.ma200 ? "\uC911\uC7A5\uAE30 \uC815\uBC30\uC5F4" : "\uC911\uC7A5\uAE30 \uC5ED\uBC30\uC5F4"}`);
  }
  trend = clampFactor(trend);

  let momentum = 0;
  if (data.rsi !== null) {
    if (data.rsi <= rules.rsi.oversoldReboundMax) momentum += 1;
    else if (data.rsi < rules.rsi.weakTrendMax) momentum -= 1;
    else if (data.rsi >= rules.rsi.bullishMin && data.rsi <= rules.rsi.bullishMax) momentum += 1;
    else if (data.rsi >= rules.rsi.overboughtMin) momentum -= 2;
  }
  if (data.rsiWeekly !== null) {
    if (data.rsiWeekly <= rules.weeklyRsi.bullishBelow) momentum += 1;
    else if (data.rsiWeekly >= rules.weeklyRsi.bearishAbove) momentum -= 1;
  }
  if (data.macdHistogram !== null) {
    momentum += data.macdHistogram > 0 ? 1 : -1;
  }
  if (data.macdCross === "bullish") momentum += 1;
  else if (data.macdCross === "bearish") momentum -= 1;
  momentum = clampFactor(momentum);
  details.push(
    `\uBAA8\uBA58\uD140: RSI ${formatRsiBand(data.rsi, rules.rsi)}, MACD ${data.macdHistogram !== null ? data.macdHistogram.toFixed(3) : "N/A"}`
  );
  details.push(`\uBD84\uBD09 RSI(${data.intradayRsiInterval}): ${formatRsiAnalysis(data.intradayRsi)}`);

  let volatility = 0;
  if (data.bollinger !== null) {
    if (data.currentPrice <= data.bollinger.lower) volatility += 2;
    else if (data.currentPrice < data.bollinger.middle) volatility += 1;
    else if (data.currentPrice >= data.bollinger.upper) volatility -= 2;
    else if (data.currentPrice > data.bollinger.middle) volatility -= 1;
  }
  if (data.marketContext.atrRatio !== null) {
    if (data.marketContext.atrRatio >= rules.volatility.atrHighPenaltyMin) volatility -= 1;
    else if (data.marketContext.atrRatio <= rules.volatility.atrLowBonusMax) volatility += 1;
  }
  if (data.marketContext.dailyReturnZScore !== null) {
    if (data.marketContext.dailyReturnZScore <= rules.volatility.zScoreReboundMax) volatility += 1;
    else if (data.marketContext.dailyReturnZScore >= rules.volatility.zScoreOverheatMin) volatility -= 1;
  }
  volatility = clampFactor(volatility);

  let flow = 0;
  if (data.volumeRatio !== null) {
    if (data.volumeRatio >= rules.flow.volumeRatioBullishMin) {
      flow += 1;
      details.push(`\uC218\uAE09: \uAC70\uB798\uB7C9 \uD3C9\uADE0 \uB300\uBE44 ${data.volumeRatio.toFixed(1)}\uBC30`);
    } else if (data.volumeRatio <= rules.flow.volumeRatioBearishMax) {
      flow -= 1;
    }
  }
  if (data.volumeSpike && (data.volumeRatio ?? 0) >= rules.flow.volumeSpikeTrendFollowMin) {
    flow += trend >= 0 ? 1 : -1;
  }
  if (data.marketContext.volumeZScore !== null && data.marketContext.volumeZScore >= rules.flow.volumeZScoreBullishMin) {
    flow += 1;
  }
  flow = clampFactor(flow);

  let relative = 0;
  if (data.relativeStrength) {
    const { diff3m, diff6m, diff1y, sector } = data.relativeStrength;
    if (diff3m !== null) {
      if (diff3m >= rules.relative.diff3mBullishMin) relative += 1;
      else if (diff3m <= rules.relative.diff3mBearishMax) relative -= 1;
    }
    if (diff6m !== null) {
      if (diff6m >= rules.relative.diff6mBullishMin) relative += 1;
      else if (diff6m <= rules.relative.diff6mBearishMax) relative -= 1;
    }
    if (diff1y !== null) {
      if (diff1y >= rules.relative.diff1yBullishMin) relative += 1;
      else if (diff1y <= rules.relative.diff1yBearishMax) relative -= 1;
    }
    details.push(
      `\uC0C1\uB300\uAC15\uB3C4: ${translateSectorName(sector)} \uC139\uD130 \uB300\uBE44 3\uAC1C\uC6D4 ${diff3m !== null ? formatPercent(diff3m) + "p" : "N/A"}, 6\uAC1C\uC6D4 ${diff6m !== null ? formatPercent(diff6m) + "p" : "N/A"}, 1\uB144 ${diff1y !== null ? formatPercent(diff1y) + "p" : "N/A"}`
    );
  }
  relative = clampFactor(relative);

  const score = trend + momentum + volatility + flow + relative;

  let label: SignalResult["label"];
  let emoji: string;
  if (score >= rules.labels.strongBuy) {
    label = "\uAC15\uD55C \uB9E4\uC218";
    emoji = "\u25b2\u25b2";
  } else if (score >= rules.labels.buy) {
    label = "\uB9E4\uC218";
    emoji = "\u25b2";
  } else if (score <= rules.labels.strongSell) {
    label = "\uAC15\uD55C \uB9E4\uB3C4";
    emoji = "\u25bc\u25bc";
  } else if (score <= rules.labels.sell) {
    label = "\uB9E4\uB3C4";
    emoji = "\u25bc";
  } else {
    label = "\uC911\uB9BD";
    emoji = "\u25a0";
  }

  details.unshift(
    `\uD329\uD130 \uC810\uC218 | \uCD94\uC138 ${formatFactor(trend)}, \uBAA8\uBA58\uD140 ${formatFactor(momentum)}, \uBCC0\uB3D9\uC131 ${formatFactor(volatility)}, \uC218\uAE09 ${formatFactor(flow)}, \uC0C1\uB300\uAC15\uB3C4 ${formatFactor(relative)}`
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
        alertsList.push(`[\uBAA8\uBA58\uD140] <b>\uACE8\uB4E0\uD06C\uB85C\uC2A4</b> (\uD788\uC2A4\uD1A0\uADF8\uB7A8 ${data.macdHistogram?.toFixed(3) ?? "N/A"})`);
        setCooldown(key);
      }
    } else if (data.macdCross === "bearish") {
      const key = `${ticker}_MACD_BEARISH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`[\uBAA8\uBA58\uD140] <b>\uB370\uB4DC\uD06C\uB85C\uC2A4</b> (\uD788\uC2A4\uD1A0\uADF8\uB7A8 ${data.macdHistogram?.toFixed(3) ?? "N/A"})`);
        setCooldown(key);
      }
    }
  }

  if (alerts.bollingerAlert && data.bollinger !== null) {
    if (data.currentPrice >= data.bollinger.upper) {
      const key = `${ticker}_BB_UPPER`;
      if (!isOnCooldown(key)) {
        alertsList.push(`[\uBCFC\uB9B0\uC800] <b>\uC0C1\uB2E8 \uB3CC\uD30C</b> (\uD604\uC7AC\uAC00 ${formatPrice(data.currentPrice)} / \uC0C1\uB2E8 ${formatPrice(data.bollinger.upper)})`);
        setCooldown(key);
      }
    } else if (data.currentPrice <= data.bollinger.lower) {
      const key = `${ticker}_BB_LOWER`;
      if (!isOnCooldown(key)) {
        alertsList.push(`[\uBCFC\uB9B0\uC800] <b>\uD558\uB2E8 \uC774\uD0C8</b> (\uD604\uC7AC\uAC00 ${formatPrice(data.currentPrice)} / \uD558\uB2E8 ${formatPrice(data.bollinger.lower)})`);
        setCooldown(key);
      }
    }
  }

  if (alerts.maCrossAlert && data.maCross !== null) {
    if (data.maCross === "golden") {
      const key = `${ticker}_MA_GOLDEN`;
      if (!isOnCooldown(key)) {
        alertsList.push(`[\uC774\uD3C9\uC120] <b>\uACE8\uB4E0\uD06C\uB85C\uC2A4</b> MA50(${formatPrice(data.ma50 ?? 0)}) > MA200(${formatPrice(data.ma200 ?? 0)})`);
        setCooldown(key);
      }
    } else if (data.maCross === "death") {
      const key = `${ticker}_MA_DEATH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`[\uC774\uD3C9\uC120] <b>\uB370\uB4DC\uD06C\uB85C\uC2A4</b> MA50(${formatPrice(data.ma50 ?? 0)}) < MA200(${formatPrice(data.ma200 ?? 0)})`);
        setCooldown(key);
      }
    }
  }

  if (alerts.stochasticAlert && data.stochasticSignal !== null && data.stochastic !== null) {
    if (data.stochasticSignal === "oversold") {
      const key = `${ticker}_STOCH_OVERSOLD`;
      if (!isOnCooldown(key)) {
        alertsList.push(`[\uC2A4\uD1A0\uCE90\uC2A4\uD2F1] <b>\uACFC\uB9E4\uB3C4</b> (%K ${data.stochastic.k.toFixed(1)})`);
        setCooldown(key);
      }
    } else if (data.stochasticSignal === "overbought") {
      const key = `${ticker}_STOCH_OVERBOUGHT`;
      if (!isOnCooldown(key)) {
        alertsList.push(`[\uC2A4\uD1A0\uCE90\uC2A4\uD2F1] <b>\uACFC\uB9E4\uC218</b> (%K ${data.stochastic.k.toFixed(1)})`);
        setCooldown(key);
      }
    }
  }

  if (
    alerts.volumeSpikeAlert &&
    data.volume !== null &&
    data.avgVolume !== null &&
    data.volumeRatio !== null &&
    data.volumeRatio >= alerts.volumeRatioThreshold
  ) {
    const key = `${ticker}_VOLUME_SPIKE`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uAC70\uB798\uB7C9] <b>\uAC70\uB798\uB7C9 \uAE09\uC99D</b> (\uD3C9\uADE0 \uB300\uBE44 ${data.volumeRatio.toFixed(1)}\uBC30)`);
      setCooldown(key);
    }
  }

  if (
    alerts.atrSpikeAlert &&
    data.marketContext.atrRatio !== null &&
    data.atr !== null &&
    data.avgAtr !== null &&
    data.marketContext.atrRatio >= alerts.atrRatioThreshold
  ) {
    const key = `${ticker}_ATR_SPIKE`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[ATR] <b>ATR \uAE09\uB4F1</b> (\uD604\uC7AC ${data.atr.toFixed(2)} / \uD3C9\uADE0 \uB300\uBE44 ${data.marketContext.atrRatio.toFixed(1)}\uBC30)`);
      setCooldown(key);
    }
  }

  if (data.rsiWeekly !== null && alerts.rsiWeeklyOversold !== null && data.rsiWeekly <= alerts.rsiWeeklyOversold) {
    const key = `${ticker}_RSI_WEEKLY_OVERSOLD`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uC8FC\uBD09 RSI] <b>\uACFC\uB9E4\uB3C4</b> (${formatRsi(data.rsiWeekly)} <= ${alerts.rsiWeeklyOversold})`);
      setCooldown(key);
    }
  }
  if (data.rsiWeekly !== null && alerts.rsiWeeklyOverbought !== null && data.rsiWeekly >= alerts.rsiWeeklyOverbought) {
    const key = `${ticker}_RSI_WEEKLY_OVERBOUGHT`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uC8FC\uBD09 RSI] <b>\uACFC\uB9E4\uC218</b> (${formatRsi(data.rsiWeekly)} >= ${alerts.rsiWeeklyOverbought})`);
      setCooldown(key);
    }
  }

  if (data.rsi !== null && data.rsi <= alerts.rsiOversold) {
    const key = `${ticker}_RSI_OVERSOLD`;
    if (!isOnCooldown(key)) {
      const stage = formatStage(data.rsi, alerts.rsiOversold, alerts.rsiOversold - 5, "low");
      alertsList.push(`[RSI] <b>\uACFC\uB9E4\uB3C4 ${stage}</b> (${formatRsi(data.rsi)} <= ${alerts.rsiOversold})`);
      setCooldown(key);
    }
  }
  if (data.rsi !== null && data.rsi >= alerts.rsiOverbought) {
    const key = `${ticker}_RSI_OVERBOUGHT`;
    if (!isOnCooldown(key)) {
      const stage = formatStage(data.rsi, alerts.rsiOverbought, alerts.rsiOverbought + 5, "high");
      alertsList.push(`[RSI] <b>\uACFC\uB9E4\uC218 ${stage}</b> (${formatRsi(data.rsi)} >= ${alerts.rsiOverbought})`);
      setCooldown(key);
    }
  }

  if (alerts.priceBelowAlert !== null && data.currentPrice <= alerts.priceBelowAlert) {
    const key = `${ticker}_PRICE_BELOW`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uAC00\uACA9] <b>\uD558\uB2E8 \uB3CC\uD30C</b> (${formatPrice(data.currentPrice)} <= ${formatPrice(alerts.priceBelowAlert)})`);
      setCooldown(key);
    }
  }
  if (alerts.priceAboveAlert !== null && data.currentPrice >= alerts.priceAboveAlert) {
    const key = `${ticker}_PRICE_ABOVE`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uAC00\uACA9] <b>\uC0C1\uB2E8 \uB3CC\uD30C</b> (${formatPrice(data.currentPrice)} >= ${formatPrice(alerts.priceAboveAlert)})`);
      setCooldown(key);
    }
  }

  if (alerts.dailyChangePercent !== null && data.dailyChangePercent <= alerts.dailyChangePercent) {
    const key = `${ticker}_DAILY_DOWN`;
    if (!isOnCooldown(key)) {
      const stage = formatStage(data.dailyChangePercent, alerts.dailyChangePercent, alerts.dailyChangePercent - 3, "low");
      alertsList.push(`[\uAC00\uACA9] <b>\uAE09\uB77D \uAC10\uC9C0 ${stage}</b> (${formatPercent(data.dailyChangePercent)})`);
      setCooldown(key);
    }
  }
  if (alerts.dailyChangePercentUp !== null && data.dailyChangePercent >= alerts.dailyChangePercentUp) {
    const key = `${ticker}_DAILY_UP`;
    if (!isOnCooldown(key)) {
      const stage = formatStage(data.dailyChangePercent, alerts.dailyChangePercentUp, alerts.dailyChangePercentUp + 3, "high");
      alertsList.push(`[\uAC00\uACA9] <b>\uAE09\uB4F1 \uAC10\uC9C0 ${stage}</b> (${formatPercent(data.dailyChangePercent)})`);
      setCooldown(key);
    }
  }

  if (data.marketContext.dailyReturnZScore !== null && alerts.dailyChangeStddevDown !== null && data.marketContext.dailyReturnZScore <= alerts.dailyChangeStddevDown) {
    const key = `${ticker}_VOLATILITY_DOWN`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uBCC0\uB3D9\uC131] <b>\uBCC0\uB3D9\uC131 \uAE30\uC900 \uAE09\uB77D</b> (\uD3C9\uC18C \uB300\uBE44 ${data.marketContext.dailyReturnZScore.toFixed(1)}\u03C3)`);
      setCooldown(key);
    }
  }
  if (data.marketContext.dailyReturnZScore !== null && alerts.dailyChangeStddevUp !== null && data.marketContext.dailyReturnZScore >= alerts.dailyChangeStddevUp) {
    const key = `${ticker}_VOLATILITY_UP`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uBCC0\uB3D9\uC131] <b>\uBCC0\uB3D9\uC131 \uAE30\uC900 \uAE09\uB4F1</b> (\uD3C9\uC18C \uB300\uBE44 +${data.marketContext.dailyReturnZScore.toFixed(1)}\u03C3)`);
      setCooldown(key);
    }
  }

  const relativeBase = data.relativeStrength?.diff3m ?? data.relativeStrength?.diff6m ?? null;
  const hasReboundSetup =
    data.rsi !== null &&
    data.rsi <= alerts.rsiOversold &&
    (data.macdCross === "bullish" || (data.macdHistogram ?? -1) > 0) &&
    (data.volumeRatio ?? 0) >= alerts.reboundVolumeRatioMin;
  if (hasReboundSetup) {
    const key = `${ticker}_COMBO_REBOUND`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uC870\uD569] <b>\uBC18\uB4F1 \uAD00\uC2EC</b> (RSI \uACFC\uB9E4\uB3C4 + MACD \uAC1C\uC120 + \uAC70\uB798\uB7C9 \uC720\uC785)`);
      setCooldown(key);
    }
  }

  const hasBreakoutSetup =
    data.bollinger !== null &&
    data.currentPrice >= data.bollinger.upper &&
    (data.volumeRatio ?? 0) >= alerts.breakoutVolumeRatioMin &&
    relativeBase !== null &&
    relativeBase >= alerts.relativeStrengthThreshold;
  if (hasBreakoutSetup) {
    const key = `${ticker}_COMBO_BREAKOUT`;
    if (!isOnCooldown(key)) {
      alertsList.push(`[\uC870\uD569] <b>\uCD94\uC138 \uC9C0\uC18D \uAC00\uB2A5\uC131</b> (\uBCFC\uB9B0\uC800 \uC0C1\uB2E8 \uB3CC\uD30C + \uAC70\uB798\uB7C9 \uC99D\uAC00 + \uC0C1\uB300\uAC15\uB3C4 \uC6B0\uC704)`);
      setCooldown(key);
    }
  }

  let includeStrongSignal = false;
  if (Math.abs(signal.score) >= alerts.strongSignalScore) {
    const signalKey = `${ticker}_SIGNAL_${signal.label}`;
    const lastSignal = alertCooldowns.get(signalKey);
    if (!lastSignal || Date.now() - lastSignal.getTime() >= SIGNAL_COOLDOWN_MS) {
      includeStrongSignal = true;
      alertCooldowns.set(signalKey, new Date());
    }
  }

  return { alerts: alertsList, includeStrongSignal };
}
