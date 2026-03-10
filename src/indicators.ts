import axios from 'axios';
import { RSI } from 'technicalindicators';
import { CONFIG } from './config.js';

export interface StockData {
  ticker: string;
  currentPrice: number;
  previousClose: number;
  dailyChangePercent: number;
  rsi: number | null;
  timestamp: Date;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        chartPreviousClose: number;
        regularMarketChangePercent?: number;
      };
      indicators: {
        quote: Array<{
          close: (number | null)[];
        }>;
      };
    }>;
    error: unknown;
  };
}

export async function fetchStockData(ticker: string): Promise<StockData> {
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
  const currentPrice = meta.regularMarketPrice ?? 0;
  const previousClose = meta.chartPreviousClose ?? 0;
  const dailyChangePercent =
    previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;

  // 종가 배열 추출 (null 제거)
  const rawCloses = result.indicators.quote[0]?.close ?? [];
  const closes = rawCloses.filter((c): c is number => c !== null && c !== undefined);

  let rsiValue: number | null = null;
  if (closes.length >= CONFIG.rsiPeriod + 1) {
    const rsiValues = RSI.calculate({ values: closes, period: CONFIG.rsiPeriod });
    rsiValue = rsiValues.length > 0 ? (rsiValues[rsiValues.length - 1] ?? null) : null;
  }

  return {
    ticker,
    currentPrice,
    previousClose,
    dailyChangePercent,
    rsi: rsiValue,
    timestamp: new Date(),
  };
}

export function isMarketOpen(): boolean {
  const now = new Date();
  const etOffset = isDaylightSavingTime(now) ? -4 : -5;
  const etTime = new Date(now.getTime() + etOffset * 60 * 60 * 1000);

  const day = etTime.getUTCDay(); // 0=일요일, 6=토요일
  if (day === 0 || day === 6) return false;

  const hours = etTime.getUTCHours();
  const minutes = etTime.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  // 9:30 ~ 16:00 ET
  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
}

function isDaylightSavingTime(date: Date): boolean {
  const year = date.getUTCFullYear();
  const marchSecondSunday = getNthSundayOfMonth(year, 2, 2);
  const novFirstSunday = getNthSundayOfMonth(year, 10, 1);
  return date >= marchSecondSunday && date < novFirstSunday;
}

function getNthSundayOfMonth(year: number, month: number, n: number): Date {
  const date = new Date(Date.UTC(year, month, 1, 7, 0, 0));
  const firstDayOfWeek = date.getUTCDay();
  const daysUntilSunday = firstDayOfWeek === 0 ? 0 : 7 - firstDayOfWeek;
  date.setUTCDate(1 + daysUntilSunday + (n - 1) * 7);
  return date;
}
