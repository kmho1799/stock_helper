import dotenv from "dotenv";
dotenv.config();

export interface StockAlert {
  rsiOversold: number;
  rsiOverbought: number;
  rsiWeeklyOversold: number | null;
  rsiWeeklyOverbought: number | null;
  priceBelowAlert: number | null;
  priceAboveAlert: number | null;
  dailyChangePercent: number | null;
  dailyChangePercentUp: number | null;
  dailyChangeStddevDown: number | null;
  dailyChangeStddevUp: number | null;
  macdCrossAlert: boolean;
  bollingerAlert: boolean;
  maCrossAlert: boolean;
  stochasticAlert: boolean;
  volumeSpikeAlert: boolean;
  atrSpikeAlert: boolean;
  volumeRatioThreshold: number;
  atrRatioThreshold: number;
  strongSignalScore: number;
  reboundVolumeRatioMin: number;
  breakoutVolumeRatioMin: number;
  relativeStrengthThreshold: number;
}

export interface SignalLabelThresholds {
  strongBuy: number;
  buy: number;
  sell: number;
  strongSell: number;
}

export interface RsiSignalRules {
  oversoldReboundMax: number;
  weakTrendMax: number;
  bullishMin: number;
  bullishMax: number;
  overboughtMin: number;
}

export interface WeeklyRsiSignalRules {
  bullishBelow: number;
  bearishAbove: number;
}

export interface VolatilitySignalRules {
  atrLowBonusMax: number;
  atrHighPenaltyMin: number;
  zScoreReboundMax: number;
  zScoreOverheatMin: number;
}

export interface FlowSignalRules {
  volumeRatioBullishMin: number;
  volumeRatioBearishMax: number;
  volumeSpikeTrendFollowMin: number;
  volumeZScoreBullishMin: number;
}

export interface RelativeStrengthSignalRules {
  diff3mBullishMin: number;
  diff3mBearishMax: number;
  diff6mBullishMin: number;
  diff6mBearishMax: number;
  diff1yBullishMin: number;
  diff1yBearishMax: number;
}

export interface SignalProfile {
  rsi: RsiSignalRules;
  weeklyRsi: WeeklyRsiSignalRules;
  volatility: VolatilitySignalRules;
  flow: FlowSignalRules;
  relative: RelativeStrengthSignalRules;
  labels: SignalLabelThresholds;
}

export type StockProfile =
  | "index_etf"
  | "mega_cap_tech"
  | "high_beta_growth"
  | "crypto_related"
  | "defensive";

export interface StockConfig {
  ticker: string;
  name: string;
  profile: StockProfile;
  alerts: StockAlert;
  signal: SignalProfile;
}

type StockDefinition = Omit<StockConfig, "alerts" | "signal"> & {
  alerts?: Partial<StockAlert>;
};

const defaultAlertFlags: Pick<
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

const PROFILE_ALERTS: Record<StockProfile, StockAlert> = {
  index_etf: {
    ...defaultAlertFlags,
    rsiOversold: 35,
    rsiOverbought: 65,
    rsiWeeklyOversold: 35,
    rsiWeeklyOverbought: 68,
    priceBelowAlert: null,
    priceAboveAlert: null,
    dailyChangePercent: -2.5,
    dailyChangePercentUp: 2.5,
    dailyChangeStddevDown: -2.2,
    dailyChangeStddevUp: 2.2,
    volumeRatioThreshold: 1.8,
    atrRatioThreshold: 1.6,
    strongSignalScore: 4,
    reboundVolumeRatioMin: 1.2,
    breakoutVolumeRatioMin: 1.4,
    relativeStrengthThreshold: 3,
  },
  mega_cap_tech: {
    ...defaultAlertFlags,
    rsiOversold: 32,
    rsiOverbought: 68,
    rsiWeeklyOversold: 35,
    rsiWeeklyOverbought: 70,
    priceBelowAlert: null,
    priceAboveAlert: null,
    dailyChangePercent: -3.5,
    dailyChangePercentUp: 3.5,
    dailyChangeStddevDown: -2.1,
    dailyChangeStddevUp: 2.1,
    volumeRatioThreshold: 1.9,
    atrRatioThreshold: 1.7,
    strongSignalScore: 4,
    reboundVolumeRatioMin: 1.3,
    breakoutVolumeRatioMin: 1.5,
    relativeStrengthThreshold: 4,
  },
  high_beta_growth: {
    ...defaultAlertFlags,
    rsiOversold: 28,
    rsiOverbought: 72,
    rsiWeeklyOversold: 32,
    rsiWeeklyOverbought: 72,
    priceBelowAlert: null,
    priceAboveAlert: null,
    dailyChangePercent: -5.5,
    dailyChangePercentUp: 5.5,
    dailyChangeStddevDown: -2.0,
    dailyChangeStddevUp: 2.0,
    volumeRatioThreshold: 2.1,
    atrRatioThreshold: 1.8,
    strongSignalScore: 5,
    reboundVolumeRatioMin: 1.4,
    breakoutVolumeRatioMin: 1.7,
    relativeStrengthThreshold: 5,
  },
  crypto_related: {
    ...defaultAlertFlags,
    rsiOversold: 25,
    rsiOverbought: 75,
    rsiWeeklyOversold: 30,
    rsiWeeklyOverbought: 75,
    priceBelowAlert: null,
    priceAboveAlert: null,
    dailyChangePercent: -7,
    dailyChangePercentUp: 7,
    dailyChangeStddevDown: -1.9,
    dailyChangeStddevUp: 1.9,
    volumeRatioThreshold: 2.3,
    atrRatioThreshold: 2.0,
    strongSignalScore: 5,
    reboundVolumeRatioMin: 1.5,
    breakoutVolumeRatioMin: 1.8,
    relativeStrengthThreshold: 6,
  },
  defensive: {
    ...defaultAlertFlags,
    rsiOversold: 35,
    rsiOverbought: 65,
    rsiWeeklyOversold: 38,
    rsiWeeklyOverbought: 68,
    priceBelowAlert: null,
    priceAboveAlert: null,
    dailyChangePercent: -2.5,
    dailyChangePercentUp: 2.5,
    dailyChangeStddevDown: -2.3,
    dailyChangeStddevUp: 2.3,
    volumeRatioThreshold: 1.7,
    atrRatioThreshold: 1.5,
    strongSignalScore: 4,
    reboundVolumeRatioMin: 1.2,
    breakoutVolumeRatioMin: 1.4,
    relativeStrengthThreshold: 3,
  },
};

const PROFILE_SIGNALS: Record<StockProfile, SignalProfile> = {
  index_etf: {
    rsi: {
      oversoldReboundMax: 33,
      weakTrendMax: 42,
      bullishMin: 48,
      bullishMax: 62,
      overboughtMin: 68,
    },
    weeklyRsi: {
      bullishBelow: 45,
      bearishAbove: 65,
    },
    volatility: {
      atrLowBonusMax: 0.85,
      atrHighPenaltyMin: 1.6,
      zScoreReboundMax: -2.2,
      zScoreOverheatMin: 2.2,
    },
    flow: {
      volumeRatioBullishMin: 1.4,
      volumeRatioBearishMax: 0.75,
      volumeSpikeTrendFollowMin: 1.8,
      volumeZScoreBullishMin: 2.0,
    },
    relative: {
      diff3mBullishMin: 2.5,
      diff3mBearishMax: -2.5,
      diff6mBullishMin: 3.5,
      diff6mBearishMax: -3.5,
      diff1yBullishMin: 6,
      diff1yBearishMax: -6,
    },
    labels: {
      strongBuy: 5,
      buy: 2,
      sell: -2,
      strongSell: -5,
    },
  },
  mega_cap_tech: {
    rsi: {
      oversoldReboundMax: 30,
      weakTrendMax: 40,
      bullishMin: 47,
      bullishMax: 65,
      overboughtMin: 72,
    },
    weeklyRsi: {
      bullishBelow: 42,
      bearishAbove: 68,
    },
    volatility: {
      atrLowBonusMax: 0.9,
      atrHighPenaltyMin: 1.8,
      zScoreReboundMax: -2.1,
      zScoreOverheatMin: 2.1,
    },
    flow: {
      volumeRatioBullishMin: 1.5,
      volumeRatioBearishMax: 0.8,
      volumeSpikeTrendFollowMin: 1.9,
      volumeZScoreBullishMin: 2.0,
    },
    relative: {
      diff3mBullishMin: 4,
      diff3mBearishMax: -4,
      diff6mBullishMin: 5,
      diff6mBearishMax: -5,
      diff1yBullishMin: 10,
      diff1yBearishMax: -10,
    },
    labels: {
      strongBuy: 6,
      buy: 2,
      sell: -2,
      strongSell: -6,
    },
  },
  high_beta_growth: {
    rsi: {
      oversoldReboundMax: 27,
      weakTrendMax: 38,
      bullishMin: 50,
      bullishMax: 68,
      overboughtMin: 78,
    },
    weeklyRsi: {
      bullishBelow: 40,
      bearishAbove: 70,
    },
    volatility: {
      atrLowBonusMax: 0.95,
      atrHighPenaltyMin: 2.0,
      zScoreReboundMax: -2.0,
      zScoreOverheatMin: 2.0,
    },
    flow: {
      volumeRatioBullishMin: 1.7,
      volumeRatioBearishMax: 0.85,
      volumeSpikeTrendFollowMin: 2.1,
      volumeZScoreBullishMin: 2.2,
    },
    relative: {
      diff3mBullishMin: 5,
      diff3mBearishMax: -5,
      diff6mBullishMin: 7,
      diff6mBearishMax: -7,
      diff1yBullishMin: 15,
      diff1yBearishMax: -15,
    },
    labels: {
      strongBuy: 6,
      buy: 3,
      sell: -3,
      strongSell: -6,
    },
  },
  crypto_related: {
    rsi: {
      oversoldReboundMax: 24,
      weakTrendMax: 35,
      bullishMin: 52,
      bullishMax: 70,
      overboughtMin: 80,
    },
    weeklyRsi: {
      bullishBelow: 38,
      bearishAbove: 72,
    },
    volatility: {
      atrLowBonusMax: 1.0,
      atrHighPenaltyMin: 2.2,
      zScoreReboundMax: -1.8,
      zScoreOverheatMin: 1.8,
    },
    flow: {
      volumeRatioBullishMin: 1.9,
      volumeRatioBearishMax: 0.9,
      volumeSpikeTrendFollowMin: 2.3,
      volumeZScoreBullishMin: 2.3,
    },
    relative: {
      diff3mBullishMin: 6,
      diff3mBearishMax: -6,
      diff6mBullishMin: 8,
      diff6mBearishMax: -8,
      diff1yBullishMin: 18,
      diff1yBearishMax: -18,
    },
    labels: {
      strongBuy: 7,
      buy: 3,
      sell: -3,
      strongSell: -7,
    },
  },
  defensive: {
    rsi: {
      oversoldReboundMax: 35,
      weakTrendMax: 43,
      bullishMin: 47,
      bullishMax: 60,
      overboughtMin: 66,
    },
    weeklyRsi: {
      bullishBelow: 46,
      bearishAbove: 64,
    },
    volatility: {
      atrLowBonusMax: 0.82,
      atrHighPenaltyMin: 1.5,
      zScoreReboundMax: -2.3,
      zScoreOverheatMin: 2.3,
    },
    flow: {
      volumeRatioBullishMin: 1.3,
      volumeRatioBearishMax: 0.75,
      volumeSpikeTrendFollowMin: 1.7,
      volumeZScoreBullishMin: 1.8,
    },
    relative: {
      diff3mBullishMin: 2,
      diff3mBearishMax: -2,
      diff6mBullishMin: 3,
      diff6mBearishMax: -3,
      diff1yBullishMin: 5,
      diff1yBearishMax: -5,
    },
    labels: {
      strongBuy: 5,
      buy: 2,
      sell: -2,
      strongSell: -5,
    },
  },
};

const STOCK_DEFINITIONS: StockDefinition[] = [
  // { ticker: "VOO", name: "S&P 500", profile: "index_etf" },
  // { ticker: "NVDA", name: "NVIDIA", profile: "high_beta_growth" },
  { ticker: "TSLA", name: "Tesla", profile: "high_beta_growth" },
  // { ticker: "META", name: "Meta", profile: "mega_cap_tech" },
  // { ticker: "GOOGL", name: "Google", profile: "mega_cap_tech" },
  // { ticker: "MSFT", name: "Microsoft", profile: "mega_cap_tech" },
  { ticker: "ORCL", name: "\uC624\uB77C\uD074", profile: "mega_cap_tech" },
  {
    ticker: "WGMI",
    name: "\uBE44\uD2B8\uCC44\uAD74 ETF",
    profile: "crypto_related",
  },
  {
    ticker: "BITF",
    name: "\uBE44\uD2B8\uD31C\uC2A4",
    profile: "crypto_related",
  },
  {
    ticker: "BMNR",
    name: "\uBE44\uD2B8\uB9C8\uC778",
    profile: "crypto_related",
  },
  {
    ticker: "SMR",
    name: "\uB274\uC2A4\uCF00\uC77C\uD30C\uC6CC",
    profile: "high_beta_growth",
  },
  {
    ticker: "QUBT",
    name: "\uD038\uD140 \uCEF4\uD4E8\uD305",
    profile: "high_beta_growth",
  },
  {
    ticker: "RR",
    name: "\uB9AC\uCE58\uD14D \uB85C\uBCF4\uD2F1\uC2A4",
    profile: "high_beta_growth",
  },
];

export const STOCKS: StockConfig[] = STOCK_DEFINITIONS.map((stock) => ({
  ticker: stock.ticker,
  name: stock.name,
  profile: stock.profile,
  alerts: {
    ...PROFILE_ALERTS[stock.profile],
    ...stock.alerts,
  },
  signal: PROFILE_SIGNALS[stock.profile],
}));

export const CONFIG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES ?? "5", 10),
  marketHoursOnly: process.env.MARKET_HOURS_ONLY === "true",
  alertDeliveryOnly: process.env.ALERT_DELIVERY_ONLY === "true",
  alertDeliveryTimezone: process.env.ALERT_DELIVERY_TIMEZONE ?? "Asia/Seoul",
  alertDeliveryStartHour: parseInt(process.env.ALERT_DELIVERY_START_HOUR ?? "17", 10),
  alertDeliveryEndHour: parseInt(process.env.ALERT_DELIVERY_END_HOUR ?? "9", 10),
  rsiPeriod: 14,
  intradayRsiInterval: (process.env.INTRADAY_RSI_INTERVAL ?? "5m") as "1m" | "2m" | "5m" | "15m" | "30m" | "60m",
  historyDays: 365,
  alertLogDir: process.env.ALERT_LOG_DIR ?? "logs",
  alertLogFile: process.env.ALERT_LOG_FILE ?? "alert-history.jsonl",
};
