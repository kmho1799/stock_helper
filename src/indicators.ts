import axios from 'axios';
import { RSI, MACD, BollingerBands, SMA, Stochastic, ATR } from 'technicalindicators';
import { CONFIG } from './config.js';

export interface StockData {
  ticker: string;
  currentPrice: number;
  previousClose: number;
  dailyChangePercent: number;
  rsi: number | null;
  rsiWeekly: number | null;
  macdCross: 'bullish' | 'bearish' | null;
  macdHistogram: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  maCross: 'golden' | 'death' | null;
  ma50: number | null;
  ma200: number | null;
  // 단타용 지표
  stochastic: { k: number; d: number } | null;
  stochasticSignal: 'oversold' | 'overbought' | null;
  atr: number | null;
  avgAtr: number | null;
  volume: number | null;
  avgVolume: number | null;
  volumeSpike: boolean;
  timestamp: Date;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        regularMarketPreviousClose?: number;
        regularMarketChangePercent?: number;
        marketState?: string;
        preMarketPrice?: number;
        preMarketChangePercent?: number;
        postMarketPrice?: number;
        postMarketChangePercent?: number;
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          close: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }>;
    error: unknown;
  };
}

export async function fetchStockData(ticker: string, marketState: string): Promise<StockData> {
  // Yahoo Finance v8 Chart API - 1회 호출로 현재 시세 + 과거 데이터 동시 수집
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
  const response = await axios.get<YahooChartResponse>(url, {
    params: {
      interval: '1d',
      range: `${CONFIG.historyDays}d`,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 10000,
  });

  const result = response.data.chart.result?.[0];
  if (!result) {
    throw new Error(`[${ticker}] Yahoo Finance에서 데이터를 가져오지 못했습니다.`);
  }

  const meta = result.meta;
  const regularPrice = meta.regularMarketPrice ?? 0;
  const previousClose = meta.regularMarketPreviousClose ?? 0;

  // 장 상태에 따라 현재가 및 변동률 결정
  let currentPrice: number;
  let dailyChangePercent: number;

  if ((marketState === 'PRE' || marketState === 'PREPRE') && meta.preMarketPrice) {
    currentPrice = meta.preMarketPrice;
    dailyChangePercent = meta.preMarketChangePercent ?? (previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);
  } else if ((marketState === 'POST' || marketState === 'POSTPOST') && meta.postMarketPrice) {
    currentPrice = meta.postMarketPrice;
    dailyChangePercent = meta.postMarketChangePercent ?? (regularPrice > 0 ? ((currentPrice - regularPrice) / regularPrice) * 100 : 0);
  } else {
    currentPrice = regularPrice;
    dailyChangePercent = meta.regularMarketChangePercent ?? (previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);
  }

  // 가격/거래량 배열 추출 (null 제거 위해 인덱스 공유)
  const quote = result.indicators.quote[0];
  const rawCloses = quote?.close ?? [];
  const rawHighs = quote?.high ?? [];
  const rawLows = quote?.low ?? [];
  const rawVolumes = quote?.volume ?? [];

  const rawTimestamps = result.timestamp ?? [];

  // 같은 인덱스에서 high/low/close 모두 유효한 데이터만 사용
  const ohlcv = rawCloses.map((c, i) => ({
    close: c,
    high: rawHighs[i] ?? null,
    low: rawLows[i] ?? null,
    volume: rawVolumes[i] ?? null,
    ts: rawTimestamps[i] ?? null,
  })).filter((d): d is { close: number; high: number; low: number; volume: number; ts: number } =>
    d.close !== null && d.high !== null && d.low !== null && d.volume !== null && d.ts !== null
  );

  const closes = ohlcv.map(d => d.close);
  const highs = ohlcv.map(d => d.high);
  const lows = ohlcv.map(d => d.low);
  const volumes = ohlcv.map(d => d.volume);

  let rsiValue: number | null = null;
  if (closes.length >= CONFIG.rsiPeriod + 1) {
    const rsiValues = RSI.calculate({ values: closes, period: CONFIG.rsiPeriod });
    rsiValue = rsiValues.length > 0 ? (rsiValues[rsiValues.length - 1] ?? null) : null;
  }

  // MACD (12, 26, 9) - 크로스오버 감지
  let macdCross: 'bullish' | 'bearish' | null = null;
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
        if (prev.histogram < 0 && curr.histogram > 0) macdCross = 'bullish';
        else if (prev.histogram > 0 && curr.histogram < 0) macdCross = 'bearish';
      }
    }
  }

  // 볼린저 밴드 (20, 2)
  let bollinger: { upper: number; middle: number; lower: number } | null = null;
  if (closes.length >= 20) {
    const bbResult = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const last = bbResult[bbResult.length - 1];
    if (last) bollinger = { upper: last.upper, middle: last.middle, lower: last.lower };
  }

  // MA50 / MA200 골든크로스·데스크로스 감지
  let maCross: 'golden' | 'death' | null = null;
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
        if (ma50Prev < ma200Prev && ma50Curr > ma200Curr) maCross = 'golden';
        else if (ma50Prev > ma200Prev && ma50Curr < ma200Curr) maCross = 'death';
      }
    }
  }

  // 스토캐스틱 (14, 3)
  let stochastic: { k: number; d: number } | null = null;
  let stochasticSignal: 'oversold' | 'overbought' | null = null;
  if (highs.length >= 14 && lows.length >= 14) {
    const stochResult = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
    const last = stochResult[stochResult.length - 1];
    if (last?.k !== undefined && last?.d !== undefined) {
      stochastic = { k: last.k, d: last.d };
      if (last.k <= 20) stochasticSignal = 'oversold';
      else if (last.k >= 80) stochasticSignal = 'overbought';
    }
  }

  // ATR (14) - 변동성 측정
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

  // 거래량 & 거래량 급등 (현재 거래량 > 20일 평균의 2배)
  const volume = volumes[volumes.length - 1] ?? null;
  const avgVolume = volumes.length >= 20
    ? volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20
    : null;
  const volumeSpike = volume !== null && avgVolume !== null && volume >= avgVolume * 2;

  // 주봉 RSI: 일봉 데이터를 주 단위로 집계 (각 주의 마지막 종가 사용)
  let rsiWeeklyValue: number | null = null;
  {
    const weekMap = new Map<string, number>();
    for (const d of ohlcv) {
      const date = new Date(d.ts * 1000);
      const year = date.getUTCFullYear();
      // ISO 주차 계산
      const startOfYear = new Date(Date.UTC(year, 0, 1));
      const weekNum = Math.ceil(((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
      const key = `${year}-W${weekNum}`;
      weekMap.set(key, d.close); // 같은 주의 나중 데이터가 덮어씀 → 주의 마지막 종가
    }
    const weeklyCloses = Array.from(weekMap.values());
    if (weeklyCloses.length >= CONFIG.rsiPeriod + 1) {
      const rsiWeeklyValues = RSI.calculate({ values: weeklyCloses, period: CONFIG.rsiPeriod });
      rsiWeeklyValue = rsiWeeklyValues.length > 0 ? (rsiWeeklyValues[rsiWeeklyValues.length - 1] ?? null) : null;
    }
  }

  return {
    ticker,
    currentPrice,
    previousClose,
    dailyChangePercent,
    rsi: rsiValue,
    rsiWeekly: rsiWeeklyValue,
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
    timestamp: new Date(),
  };
}

// Yahoo Finance marketState: REGULAR=정규장, PRE=프리마켓, POST=애프터마켓, CLOSED=휴장
// SPY 기준으로 전체 장 상태를 조회 (개별 종목은 marketState가 없는 경우 있음)
export async function getMarketState(): Promise<string> {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/SPY';
    const response = await axios.get<YahooChartResponse>(url, {
      params: { interval: '1d', range: '1d' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000,
    });
    return response.data.chart.result?.[0]?.meta?.marketState ?? 'CLOSED';
  } catch {
    return 'CLOSED';
  }
}
