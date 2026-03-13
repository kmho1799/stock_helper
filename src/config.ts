import dotenv from "dotenv";
dotenv.config();

export interface StockAlert {
  // RSI 과매도 기준 (이 값 이하면 알림)
  rsiOversold: number;
  // RSI 과매수 기준 (이 값 이상이면 알림)
  rsiOverbought: number;
  // 주봉 RSI 과매도 기준 (null이면 비활성)
  rsiWeeklyOversold: number | null;
  // 주봉 RSI 과매수 기준 (null이면 비활성)
  rsiWeeklyOverbought: number | null;
  // 가격 이하 알림 (null이면 비활성)
  priceBelowAlert: number | null;
  // 가격 이상 알림 (null이면 비활성)
  priceAboveAlert: number | null;
  // 일간 변동률 하락 기준 % (예: -5 이면 -5% 이하일 때 알림)
  dailyChangePercent: number | null;
  // 일간 변동률 상승 기준 % (예: 5 이면 +5% 이상일 때 알림)
  dailyChangePercentUp: number | null;
  // MACD 크로스 알림 (true이면 활성)
  macdCrossAlert: boolean;
  // 볼린저 밴드 이탈 알림 (true이면 활성)
  bollingerAlert: boolean;
  // 골든크로스/데스크로스 알림 (true이면 활성)
  maCrossAlert: boolean;
  // 스토캐스틱 알림 (true이면 활성)
  stochasticAlert: boolean;
  // 거래량 급등 알림 (true이면 활성)
  volumeSpikeAlert: boolean;
  // ATR 급등 알림 (true이면 활성, 20일 평균의 2배 이상)
  atrSpikeAlert: boolean;
}

export interface StockConfig {
  ticker: string;
  name: string;
  alerts: StockAlert;
}

const defaultAlerts: Pick<
  StockAlert,
  | "macdCrossAlert"
  | "bollingerAlert"
  | "maCrossAlert"
  | "stochasticAlert"
  | "volumeSpikeAlert"
  | "atrSpikeAlert"
> = {
  macdCrossAlert: true,
  bollingerAlert: true,
  maCrossAlert: true,
  stochasticAlert: true,
  volumeSpikeAlert: true,
  atrSpikeAlert: true,
};

export const STOCKS: StockConfig[] = [
  {
    ticker: "VOO",
    name: "S&P 500",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "NVDA",
    name: "NVIDIA",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "TSLA",
    name: "Tesla",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "META",
    name: "Meta",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "GOOGL",
    name: "Google",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "ORCL",
    name: "오라클",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "WGMI",
    name: "비트채굴 ETF",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "BITF",
    name: "비트팜스",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "BMNR",
    name: "비트마인",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "SMR",
    name: "뉴스케일파워",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "QUBT",
    name: "퀀텀 컴퓨팅",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
  {
    ticker: "RR",
    name: "리치텍 로보틱스",
    alerts: {
      ...defaultAlerts,
      rsiOversold: 30,
      rsiOverbought: 70,
      rsiWeeklyOversold: 30,
      rsiWeeklyOverbought: 70,
      priceBelowAlert: null,
      priceAboveAlert: null,
      dailyChangePercent: -5,
      dailyChangePercentUp: 5,
    },
  },
];

export const CONFIG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES ?? "5", 10),
  marketHoursOnly: process.env.MARKET_HOURS_ONLY === "true",
  // RSI 계산을 위한 기간 (일)
  rsiPeriod: 14,
  // 과거 데이터 수집 기간 (일) - MA200 계산을 위해 충분히 확보
  historyDays: 365,
};
