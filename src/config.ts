import dotenv from 'dotenv';
dotenv.config();

export interface StockAlert {
  // RSI 과매도 기준 (이 값 이하면 알림)
  rsiOversold: number;
  // RSI 과매수 기준 (이 값 이상이면 알림)
  rsiOverbought: number;
  // 가격 이하 알림 (null이면 비활성)
  priceBelowAlert: number | null;
  // 가격 이상 알림 (null이면 비활성)
  priceAboveAlert: number | null;
  // 일간 변동률 하락 기준 % (예: -5 이면 -5% 이하일 때 알림)
  dailyChangePercent: number | null;
  // 일간 변동률 상승 기준 % (예: 5 이면 +5% 이상일 때 알림)
  dailyChangePercentUp: number | null;
}

export interface StockConfig {
  ticker: string;
  name: string;
  alerts: StockAlert;
}

export const STOCKS: StockConfig[] = [
  {
    ticker: 'NVDA',
    name: 'NVIDIA',
    alerts: {
      rsiOversold: 30,
      rsiOverbought: 70,
      priceBelowAlert: null,   // 예: 100 으로 설정하면 $100 이하일 때 알림
      priceAboveAlert: null,   // 예: 200 으로 설정하면 $200 이상일 때 알림
      dailyChangePercent: -5,  // 하루 -5% 이하 하락 시 알림
      dailyChangePercentUp: 5, // 하루 +5% 이상 상승 시 알림
    },
  },
  {
    ticker: 'TSLA',
    name: 'Tesla',
    alerts: {
      rsiOversold: 30,
      rsiOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
];

export const CONFIG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES ?? '5', 10),
  marketHoursOnly: process.env.MARKET_HOURS_ONLY === 'true',
  // RSI 계산을 위한 기간 (일)
  rsiPeriod: 14,
  // 과거 데이터 수집 기간 (일)
  historyDays: 30,
};
