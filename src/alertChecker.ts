import { StockConfig } from './config.js';
import { StockData } from './indicators.js';

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
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatRsi(rsi: number): string {
  return rsi.toFixed(1);
}

export interface SignalResult {
  score: number;
  label: '강한 매수' | '매수' | '중립' | '매도' | '강한 매도';
  emoji: string;
  details: string[];
}

export interface AlertCheckResult {
  alerts: string[];
  includeStrongSignal: boolean;
}

export function analyzeSignal(data: StockData): SignalResult {
  let score = 0;
  const details: string[] = [];

  // RSI 일봉
  if (data.rsi !== null) {
    if (data.rsi <= 30)      { score += 2; details.push(`RSI일봉 ${data.rsi.toFixed(1)} 과매도 +2`); }
    else if (data.rsi <= 45) { score += 1; details.push(`RSI일봉 ${data.rsi.toFixed(1)} 약세권 +1`); }
    else if (data.rsi >= 70) { score -= 2; details.push(`RSI일봉 ${data.rsi.toFixed(1)} 과매수 -2`); }
    else if (data.rsi >= 55) { score -= 1; details.push(`RSI일봉 ${data.rsi.toFixed(1)} 강세권 -1`); }
  }

  // RSI 주봉
  if (data.rsiWeekly !== null) {
    if (data.rsiWeekly <= 40)      { score += 1; details.push(`RSI주봉 ${data.rsiWeekly.toFixed(1)} 과매도 +1`); }
    else if (data.rsiWeekly >= 60) { score -= 1; details.push(`RSI주봉 ${data.rsiWeekly.toFixed(1)} 과매수 -1`); }
  }

  // MACD
  if (data.macdHistogram !== null) {
    if (data.macdHistogram > 0) { score += 1; details.push(`MACD 히스토그램 양수 +1`); }
    else                        { score -= 1; details.push(`MACD 히스토그램 음수 -1`); }
  }
  if (data.macdCross === 'bullish')  { score += 1; details.push(`MACD 골든크로스 +1`); }
  else if (data.macdCross === 'bearish') { score -= 1; details.push(`MACD 데드크로스 -1`); }

  // 볼린저 밴드
  if (data.bollinger !== null) {
    const { upper, lower, middle } = data.bollinger;
    if (data.currentPrice <= lower)       { score += 2; details.push(`볼린저 하단 이탈 +2`); }
    else if (data.currentPrice < middle)  { score += 1; details.push(`볼린저 중간선 아래 +1`); }
    else if (data.currentPrice >= upper)  { score -= 2; details.push(`볼린저 상단 돌파 -2`); }
    else if (data.currentPrice > middle)  { score -= 1; details.push(`볼린저 중간선 위 -1`); }
  }

  // 스토캐스틱
  if (data.stochastic !== null) {
    if (data.stochastic.k <= 20)      { score += 1; details.push(`스토캐스틱 과매도 +1`); }
    else if (data.stochastic.k >= 80) { score -= 1; details.push(`스토캐스틱 과매수 -1`); }
  }

  // MA50 vs MA200 (장기 추세)
  if (data.ma50 !== null && data.ma200 !== null) {
    if (data.ma50 > data.ma200) { score += 1; details.push(`MA50↑MA200 상승추세 +1`); }
    else                        { score -= 1; details.push(`MA50↓MA200 하락추세 -1`); }
  }

  // 현재가 vs MA50 (단기 추세)
  if (data.ma50 !== null) {
    if (data.currentPrice > data.ma50) { score += 1; details.push(`현재가↑MA50 +1`); }
    else                               { score -= 1; details.push(`현재가↓MA50 -1`); }
  }

  // 거래량 급등 시 신호 강화
  if (data.volumeSpike && score !== 0) {
    const boost = score > 0 ? 1 : -1;
    score += boost;
    details.push(`거래량 급등 신호 강화 ${boost > 0 ? '+' : ''}${boost}`);
  }

  let label: SignalResult['label'];
  let emoji: string;
  if (score >= 5)       { label = '강한 매수'; emoji = '🟢'; }
  else if (score >= 2)  { label = '매수';     emoji = '🔵'; }
  else if (score <= -5) { label = '강한 매도'; emoji = '🔴'; }
  else if (score <= -2) { label = '매도';     emoji = '🟡'; }
  else                  { label = '중립';     emoji = '⚪'; }

  return { score, label, emoji, details };
}

export function checkAlerts(stock: StockConfig, data: StockData, signal: SignalResult): AlertCheckResult {
  const { ticker, alerts } = stock;
  const alertsList: string[] = [];

  // --- MACD 크로스오버 ---
  if (alerts.macdCrossAlert && data.macdCross !== null) {
    if (data.macdCross === 'bullish') {
      const key = `${ticker}_MACD_BULLISH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`📗 <b>MACD 골든크로스</b> (히스토그램: ${data.macdHistogram?.toFixed(3) ?? 'N/A'})`);
        setCooldown(key);
      }
    } else if (data.macdCross === 'bearish') {
      const key = `${ticker}_MACD_BEARISH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`📕 <b>MACD 데드크로스</b> (히스토그램: ${data.macdHistogram?.toFixed(3) ?? 'N/A'})`);
        setCooldown(key);
      }
    }
  }

  // --- 볼린저 밴드 이탈 ---
  if (alerts.bollingerAlert && data.bollinger !== null) {
    if (data.currentPrice >= data.bollinger.upper) {
      const key = `${ticker}_BB_UPPER`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🔺 <b>볼린저 상단 돌파</b> (현재가: ${formatPrice(data.currentPrice)} / 상단: ${formatPrice(data.bollinger.upper)})`);
        setCooldown(key);
      }
    } else if (data.currentPrice <= data.bollinger.lower) {
      const key = `${ticker}_BB_LOWER`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🔻 <b>볼린저 하단 이탈</b> (현재가: ${formatPrice(data.currentPrice)} / 하단: ${formatPrice(data.bollinger.lower)})`);
        setCooldown(key);
      }
    }
  }

  // --- 골든크로스/데스크로스 ---
  if (alerts.maCrossAlert && data.maCross !== null) {
    if (data.maCross === 'golden') {
      const key = `${ticker}_MA_GOLDEN`;
      if (!isOnCooldown(key)) {
        alertsList.push(`✨ <b>골든크로스</b> MA50(${formatPrice(data.ma50 ?? 0)}) ↑ MA200(${formatPrice(data.ma200 ?? 0)})`);
        setCooldown(key);
      }
    } else if (data.maCross === 'death') {
      const key = `${ticker}_MA_DEATH`;
      if (!isOnCooldown(key)) {
        alertsList.push(`💀 <b>데스크로스</b> MA50(${formatPrice(data.ma50 ?? 0)}) ↓ MA200(${formatPrice(data.ma200 ?? 0)})`);
        setCooldown(key);
      }
    }
  }

  // --- 스토캐스틱 ---
  if (alerts.stochasticAlert && data.stochasticSignal !== null && data.stochastic !== null) {
    if (data.stochasticSignal === 'oversold') {
      const key = `${ticker}_STOCH_OVERSOLD`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🔵 <b>스토캐스틱 과매도</b> (%K: ${data.stochastic.k.toFixed(1)})`);
        setCooldown(key);
      }
    } else if (data.stochasticSignal === 'overbought') {
      const key = `${ticker}_STOCH_OVERBOUGHT`;
      if (!isOnCooldown(key)) {
        alertsList.push(`🔴 <b>스토캐스틱 과매수</b> (%K: ${data.stochastic.k.toFixed(1)})`);
        setCooldown(key);
      }
    }
  }

  // --- 거래량 급등 ---
  if (alerts.volumeSpikeAlert && data.volumeSpike && data.volume !== null && data.avgVolume !== null) {
    const key = `${ticker}_VOLUME_SPIKE`;
    if (!isOnCooldown(key)) {
      const ratio = (data.volume / data.avgVolume).toFixed(1);
      alertsList.push(`📢 <b>거래량 급등</b> (평균대비 ${ratio}배)`);
      setCooldown(key);
    }
  }

  // --- 주봉 RSI ---
  if (data.rsiWeekly !== null && alerts.rsiWeeklyOversold !== null && data.rsiWeekly <= alerts.rsiWeeklyOversold) {
    const key = `${ticker}_RSI_WEEKLY_OVERSOLD`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🔵 <b>주봉 RSI 과매도</b> (${formatRsi(data.rsiWeekly)} ≤ ${alerts.rsiWeeklyOversold})`);
      setCooldown(key);
    }
  }
  if (data.rsiWeekly !== null && alerts.rsiWeeklyOverbought !== null && data.rsiWeekly >= alerts.rsiWeeklyOverbought) {
    const key = `${ticker}_RSI_WEEKLY_OVERBOUGHT`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🔴 <b>주봉 RSI 과매수</b> (${formatRsi(data.rsiWeekly)} ≥ ${alerts.rsiWeeklyOverbought})`);
      setCooldown(key);
    }
  }

  // --- RSI 일봉 ---
  if (data.rsi !== null && data.rsi <= alerts.rsiOversold) {
    const key = `${ticker}_RSI_OVERSOLD`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🔵 <b>RSI 과매도</b> (${formatRsi(data.rsi)} ≤ ${alerts.rsiOversold})`);
      setCooldown(key);
    }
  }
  if (data.rsi !== null && data.rsi >= alerts.rsiOverbought) {
    const key = `${ticker}_RSI_OVERBOUGHT`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🔴 <b>RSI 과매수</b> (${formatRsi(data.rsi)} ≥ ${alerts.rsiOverbought})`);
      setCooldown(key);
    }
  }

  // --- 가격 알림 ---
  if (alerts.priceBelowAlert !== null && data.currentPrice <= alerts.priceBelowAlert) {
    const key = `${ticker}_PRICE_BELOW`;
    if (!isOnCooldown(key)) {
      alertsList.push(`📉 <b>가격 하한선 돌파</b> (${formatPrice(data.currentPrice)} ≤ ${formatPrice(alerts.priceBelowAlert)})`);
      setCooldown(key);
    }
  }
  if (alerts.priceAboveAlert !== null && data.currentPrice >= alerts.priceAboveAlert) {
    const key = `${ticker}_PRICE_ABOVE`;
    if (!isOnCooldown(key)) {
      alertsList.push(`📈 <b>가격 상한선 돌파</b> (${formatPrice(data.currentPrice)} ≥ ${formatPrice(alerts.priceAboveAlert)})`);
      setCooldown(key);
    }
  }

  // --- 일간 변동률 ---
  if (alerts.dailyChangePercent !== null && data.dailyChangePercent <= alerts.dailyChangePercent) {
    const key = `${ticker}_DAILY_DOWN`;
    if (!isOnCooldown(key)) {
      alertsList.push(`⚠️ <b>급락 감지</b> (${formatPercent(data.dailyChangePercent)})`);
      setCooldown(key);
    }
  }
  if (alerts.dailyChangePercentUp !== null && data.dailyChangePercent >= alerts.dailyChangePercentUp) {
    const key = `${ticker}_DAILY_UP`;
    if (!isOnCooldown(key)) {
      alertsList.push(`🚀 <b>급등 감지</b> (${formatPercent(data.dailyChangePercent)})`);
      setCooldown(key);
    }
  }

  // --- 강한 신호 쿨다운 체크 (4시간) ---
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
