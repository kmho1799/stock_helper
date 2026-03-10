import { StockConfig } from './config.js';
import { StockData } from './indicators.js';
import { sendMessage } from './telegram.js';

// 같은 조건에 대해 반복 알림을 방지하기 위한 쿨다운 상태
// key: "TICKER_CONDITION", value: 마지막 알림 시각
const alertCooldowns = new Map<string, Date>();

// 같은 조건은 1시간 내 재알림 하지 않음
const COOLDOWN_MS = 60 * 60 * 1000;

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

export async function checkAlerts(stock: StockConfig, data: StockData): Promise<void> {
  const { ticker, name, alerts } = stock;
  const alerts_to_send: string[] = [];

  // --- RSI 과매도 체크 ---
  if (data.rsi !== null && data.rsi <= alerts.rsiOversold) {
    const key = `${ticker}_RSI_OVERSOLD`;
    if (!isOnCooldown(key)) {
      alerts_to_send.push(
        `🔵 <b>RSI 과매도</b>\n` +
        `RSI: <b>${formatRsi(data.rsi)}</b> (기준: ≤ ${alerts.rsiOversold})`
      );
      setCooldown(key);
    }
  }

  // --- RSI 과매수 체크 ---
  if (data.rsi !== null && data.rsi >= alerts.rsiOverbought) {
    const key = `${ticker}_RSI_OVERBOUGHT`;
    if (!isOnCooldown(key)) {
      alerts_to_send.push(
        `🔴 <b>RSI 과매수</b>\n` +
        `RSI: <b>${formatRsi(data.rsi)}</b> (기준: ≥ ${alerts.rsiOverbought})`
      );
      setCooldown(key);
    }
  }

  // --- 가격 이하 알림 ---
  if (alerts.priceBelowAlert !== null && data.currentPrice <= alerts.priceBelowAlert) {
    const key = `${ticker}_PRICE_BELOW`;
    if (!isOnCooldown(key)) {
      alerts_to_send.push(
        `📉 <b>가격 하한선 돌파</b>\n` +
        `현재가: <b>${formatPrice(data.currentPrice)}</b> (기준: ≤ ${formatPrice(alerts.priceBelowAlert)})`
      );
      setCooldown(key);
    }
  }

  // --- 가격 이상 알림 ---
  if (alerts.priceAboveAlert !== null && data.currentPrice >= alerts.priceAboveAlert) {
    const key = `${ticker}_PRICE_ABOVE`;
    if (!isOnCooldown(key)) {
      alerts_to_send.push(
        `📈 <b>가격 상한선 돌파</b>\n` +
        `현재가: <b>${formatPrice(data.currentPrice)}</b> (기준: ≥ ${formatPrice(alerts.priceAboveAlert)})`
      );
      setCooldown(key);
    }
  }

  // --- 일간 변동률 하락 알림 ---
  if (
    alerts.dailyChangePercent !== null &&
    data.dailyChangePercent <= alerts.dailyChangePercent
  ) {
    const key = `${ticker}_DAILY_DOWN`;
    if (!isOnCooldown(key)) {
      alerts_to_send.push(
        `⚠️ <b>급락 감지</b>\n` +
        `일간 변동: <b>${formatPercent(data.dailyChangePercent)}</b> (기준: ≤ ${alerts.dailyChangePercent}%)`
      );
      setCooldown(key);
    }
  }

  // --- 일간 변동률 상승 알림 ---
  if (
    alerts.dailyChangePercentUp !== null &&
    data.dailyChangePercent >= alerts.dailyChangePercentUp
  ) {
    const key = `${ticker}_DAILY_UP`;
    if (!isOnCooldown(key)) {
      alerts_to_send.push(
        `🚀 <b>급등 감지</b>\n` +
        `일간 변동: <b>${formatPercent(data.dailyChangePercent)}</b> (기준: ≥ +${alerts.dailyChangePercentUp}%)`
      );
      setCooldown(key);
    }
  }

  // 알림이 있으면 하나의 메세지로 합쳐서 전송
  if (alerts_to_send.length > 0) {
    const rsiDisplay = data.rsi !== null ? formatRsi(data.rsi) : 'N/A';
    const header =
      `🔔 <b>[${ticker}] ${name} 알림</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💰 현재가: ${formatPrice(data.currentPrice)}\n` +
      `📊 일간: ${formatPercent(data.dailyChangePercent)}\n` +
      `📉 RSI(14): ${rsiDisplay}\n` +
      `━━━━━━━━━━━━━━━\n`;

    const body = alerts_to_send.join('\n\n');
    const footer = `\n\n🕐 ${data.timestamp.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;

    await sendMessage(header + body + footer);
  }
}
