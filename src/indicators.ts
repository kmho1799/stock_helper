import YahooFinance from "yahoo-finance2";
import {
  ATR,
  BollingerBands,
  MACD,
  RSI,
  SMA,
  Stochastic,
} from "technicalindicators";
import { CONFIG } from "./config.js";

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const SECTOR_ETF_MAP: Record<string, string> = {
  Technology: "XLK",
  Healthcare: "XLV",
  "Financial Services": "XLF",
  Financials: "XLF",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  Industrials: "XLI",
  "Basic Materials": "XLB",
  "Real Estate": "XLRE",
  "Communication Services": "XLC",
  Utilities: "XLU",
};

export interface RelativeStrength {
  sector: string | null;
  sectorEtf: string | null;
  diff3m: number | null;
  diff6m: number | null;
  diff1y: number | null;
}

export interface StockData {
  ticker: string;
  currentPrice: number;
  previousClose: number;
  dailyChangePercent: number;
  rsi: number | null;
  rsiWeekly: number | null;
  intradayRsi: number | null;
  intradayRsiInterval: string;
  macdCross: "bullish" | "bearish" | null;
  macdHistogram: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  maCross: "golden" | "death" | null;
  ma50: number | null;
  ma200: number | null;
  stochastic: { k: number; d: number } | null;
  stochasticSignal: "oversold" | "overbought" | null;
  atr: number | null;
  avgAtr: number | null;
  volume: number | null;
  avgVolume: number | null;
  volumeSpike: boolean;
  volumeRatio: number | null;
  relativeStrength: RelativeStrength | null;
  timestamp: Date;
}

function computeWindowReturn(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null;
  const start = closes[closes.length - bars - 1];
  const end = closes[closes.length - 1];
  if (!start || !end) return null;
  return ((end / start) - 1) * 100;
}

async function getRelativeStrength(ticker: string, closes: number[]): Promise<RelativeStrength | null> {
  try {
    const summary = await yf.quoteSummary(ticker, { modules: ["assetProfile"] });
    const sector = summary.assetProfile?.sector ?? null;
    const sectorEtf = sector ? SECTOR_ETF_MAP[sector] ?? null : null;
    if (!sectorEtf) {
      return { sector, sectorEtf: null, diff3m: null, diff6m: null, diff1y: null };
    }

    const period1 = new Date();
    period1.setDate(period1.getDate() - 380);
    const sectorChart = await yf.chart(sectorEtf, { period1, interval: "1d" });
    const sectorCloses = (sectorChart.quotes ?? [])
      .map((q) => q.close)
      .filter((close): close is number => close !== null && close !== undefined);

    const stock3m = computeWindowReturn(closes, 63);
    const etf3m = computeWindowReturn(sectorCloses, 63);
    const stock6m = computeWindowReturn(closes, 126);
    const etf6m = computeWindowReturn(sectorCloses, 126);
    const stock1y = closes.length > 1 && closes[0] > 0 ? ((closes[closes.length - 1] / closes[0]) - 1) * 100 : null;
    const etf1y = sectorCloses.length > 1 && sectorCloses[0] > 0 ? ((sectorCloses[sectorCloses.length - 1] / sectorCloses[0]) - 1) * 100 : null;

    return {
      sector,
      sectorEtf,
      diff3m: stock3m !== null && etf3m !== null ? stock3m - etf3m : null,
      diff6m: stock6m !== null && etf6m !== null ? stock6m - etf6m : null,
      diff1y: stock1y !== null && etf1y !== null ? stock1y - etf1y : null,
    };
  } catch {
    return null;
  }
}

export async function fetchStockData(ticker: string, marketState: string): Promise<StockData> {
  const quote = await yf.quote(ticker);

  const regularPrice = quote.regularMarketPrice ?? 0;
  const previousClose = quote.regularMarketPreviousClose ?? regularPrice;

  let currentPrice: number;
  if ((marketState === "PRE" || marketState === "PREPRE") && quote.preMarketPrice) {
    currentPrice = quote.preMarketPrice;
  } else if ((marketState === "POST" || marketState === "POSTPOST") && quote.postMarketPrice) {
    currentPrice = quote.postMarketPrice;
  } else {
    currentPrice = regularPrice;
  }

  let dailyChangePercent: number;
  if ((marketState === "PRE" || marketState === "PREPRE") && quote.preMarketPrice) {
    dailyChangePercent = quote.preMarketChangePercent ?? (previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);
  } else if ((marketState === "POST" || marketState === "POSTPOST") && quote.postMarketPrice) {
    dailyChangePercent = quote.postMarketChangePercent ?? (regularPrice > 0 ? ((currentPrice - regularPrice) / regularPrice) * 100 : 0);
  } else {
    dailyChangePercent = quote.regularMarketChangePercent ?? (previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);
  }

  const period1 = new Date();
  period1.setDate(period1.getDate() - CONFIG.historyDays);

  const chartResult = await yf.chart(ticker, { period1, interval: "1d" });
  const rawQuotes = chartResult.quotes ?? [];

  const ohlcv = rawQuotes.filter(
    (d): d is { date: Date; high: number; low: number; close: number; volume: number; open: number; adjclose?: number } =>
      d.high != null && d.low != null && d.close != null && d.volume != null
  );

  const closes = ohlcv.map((d) => d.close);
  const highs = ohlcv.map((d) => d.high);
  const lows = ohlcv.map((d) => d.low);
  const volumes = ohlcv.map((d) => d.volume);

  let rsiValue: number | null = null;
  if (closes.length >= CONFIG.rsiPeriod + 1) {
    const rsiValues = RSI.calculate({ values: closes, period: CONFIG.rsiPeriod });
    rsiValue = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] ?? null : null;
  }

  let macdCross: "bullish" | "bearish" | null = null;
  let macdHistogram: number | null = null;
  if (closes.length >= 35) {
    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    if (macdResult.length >= 2) {
      const prev = macdResult[macdResult.length - 2];
      const curr = macdResult[macdResult.length - 1];
      macdHistogram = curr?.histogram ?? null;
      if (prev?.histogram !== undefined && curr?.histogram !== undefined) {
        if (prev.histogram < 0 && curr.histogram > 0) macdCross = "bullish";
        else if (prev.histogram > 0 && curr.histogram < 0) macdCross = "bearish";
      }
    }
  }

  let bollinger: { upper: number; middle: number; lower: number } | null = null;
  if (closes.length >= 20) {
    const bbResult = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const last = bbResult[bbResult.length - 1];
    if (last) bollinger = { upper: last.upper, middle: last.middle, lower: last.lower };
  }

  let maCross: "golden" | "death" | null = null;
  let ma50: number | null = null;
  let ma200: number | null = null;
  if (closes.length >= 201) {
    const ma50Result = SMA.calculate({ values: closes, period: 50 });
    const ma200Result = SMA.calculate({ values: closes, period: 200 });
    if (ma50Result.length >= 2 && ma200Result.length >= 2) {
      const ma50Curr = ma50Result[ma50Result.length - 1] ?? null;
      const ma50Prev = ma50Result[ma50Result.length - 2] ?? null;
      const ma200Curr = ma200Result[ma200Result.length - 1] ?? null;
      const ma200Prev = ma200Result[ma200Result.length - 2] ?? null;
      ma50 = ma50Curr;
      ma200 = ma200Curr;
      if (ma50Prev !== null && ma200Prev !== null && ma50Curr !== null && ma200Curr !== null) {
        if (ma50Prev < ma200Prev && ma50Curr > ma200Curr) maCross = "golden";
        else if (ma50Prev > ma200Prev && ma50Curr < ma200Curr) maCross = "death";
      }
    }
  }

  let stochastic: { k: number; d: number } | null = null;
  let stochasticSignal: "oversold" | "overbought" | null = null;
  if (highs.length >= 14) {
    const stochResult = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
    const last = stochResult[stochResult.length - 1];
    if (last?.k !== undefined && last?.d !== undefined) {
      stochastic = { k: last.k, d: last.d };
      if (last.k <= 20) stochasticSignal = "oversold";
      else if (last.k >= 80) stochasticSignal = "overbought";
    }
  }

  let atr: number | null = null;
  let avgAtr: number | null = null;
  if (highs.length >= 15) {
    const atrResult = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    atr = atrResult[atrResult.length - 1] ?? null;
    if (atrResult.length >= 20) {
      const recent = atrResult.slice(-20);
      avgAtr = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    }
  }

  const volume = volumes[volumes.length - 1] ?? null;
  const avgVolume = volumes.length >= 20 ? volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20 : null;
  const volumeRatio = volume !== null && avgVolume !== null && avgVolume > 0 ? volume / avgVolume : null;
  const volumeSpike = volumeRatio !== null && volumeRatio >= 2;

  let rsiWeeklyValue: number | null = null;
  {
    const weekMap = new Map<string, number>();
    for (const d of ohlcv) {
      const date = new Date(d.date);
      const year = date.getUTCFullYear();
      const startOfYear = new Date(Date.UTC(year, 0, 1));
      const weekNum = Math.ceil((((date.getTime() - startOfYear.getTime()) / 86400000) + startOfYear.getUTCDay() + 1) / 7);
      weekMap.set(`${year}-W${weekNum}`, d.close);
    }
    const weeklyCloses = Array.from(weekMap.values());
    if (weeklyCloses.length >= CONFIG.rsiPeriod + 1) {
      const rsiWeeklyValues = RSI.calculate({ values: weeklyCloses, period: CONFIG.rsiPeriod });
      rsiWeeklyValue = rsiWeeklyValues.length > 0 ? rsiWeeklyValues[rsiWeeklyValues.length - 1] ?? null : null;
    }
  }

  let intradayRsi: number | null = null;
  const intradayRsiInterval = "15분";
  try {
    const intradayPeriod1 = new Date();
    intradayPeriod1.setDate(intradayPeriod1.getDate() - 5);
    const intradayChart = await yf.chart(ticker, { period1: intradayPeriod1, interval: "5m" });
    const intradayCloses = (intradayChart.quotes ?? [])
      .map((q) => q.close)
      .filter((close): close is number => close !== null && close !== undefined);
    if (intradayCloses.length >= CONFIG.rsiPeriod + 1) {
      const intradayRsiValues = RSI.calculate({ values: intradayCloses, period: CONFIG.rsiPeriod });
      intradayRsi = intradayRsiValues.length > 0 ? intradayRsiValues[intradayRsiValues.length - 1] ?? null : null;
    }
  } catch {
    intradayRsi = null;
  }

  const relativeStrength = await getRelativeStrength(ticker, closes);

  return {
    ticker,
    currentPrice,
    previousClose,
    dailyChangePercent,
    rsi: rsiValue,
    rsiWeekly: rsiWeeklyValue,
    intradayRsi,
    intradayRsiInterval,
    macdCross,
    macdHistogram,
    bollinger,
    maCross,
    ma50,
    ma200,
    stochastic,
    stochasticSignal,
    atr,
    avgAtr,
    volume,
    avgVolume,
    volumeSpike,
    volumeRatio,
    relativeStrength,
    timestamp: new Date(),
  };
}

function getMarketStateByTime(): string {
  const now = new Date();
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = etTime.getDay();
  const totalMinutes = etTime.getHours() * 60 + etTime.getMinutes();

  if (day === 0 || day === 6) return "CLOSED";
  if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) return "PRE";
  if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) return "REGULAR";
  if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) return "POST";
  return "CLOSED";
}

export async function getMarketState(): Promise<string> {
  try {
    const quote = await yf.quote("SPY");
    const state = quote.marketState;
    if (state) return state;
  } catch {
  }

  return getMarketStateByTime();
}

