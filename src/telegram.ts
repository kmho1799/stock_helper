import TelegramBot from 'node-telegram-bot-api';
import { CONFIG } from './config.js';

let bot: TelegramBot | null = null;

export function initTelegram(): boolean {
  if (!CONFIG.telegramBotToken || CONFIG.telegramBotToken === 'your_bot_token_here') {
    console.warn('[Telegram] 봇 토큰이 설정되지 않았습니다. .env 파일을 확인하세요.');
    return false;
  }
  if (!CONFIG.telegramChatId || CONFIG.telegramChatId === 'your_chat_id_here') {
    console.warn('[Telegram] Chat ID가 설정되지 않았습니다. .env 파일을 확인하세요.');
    return false;
  }

  bot = new TelegramBot(CONFIG.telegramBotToken, { polling: false });
  console.log('[Telegram] 봇 초기화 완료');
  return true;
}

export async function sendMessage(message: string): Promise<void> {
  if (!bot) {
    console.log('[Telegram 미설정] 메세지:', message);
    return;
  }

  try {
    await bot.sendMessage(CONFIG.telegramChatId, message, { parse_mode: 'HTML' });
    console.log('[Telegram] 메세지 전송 완료');
  } catch (err) {
    console.error('[Telegram] 메세지 전송 실패:', err);
  }
}

export async function sendStartupMessage(): Promise<void> {
  const stocks = ['NVDA', 'TSLA'];
  const message =
    `🚀 <b>주식 모니터링 시작</b>\n\n` +
    `📊 추적 종목: ${stocks.join(', ')}\n` +
    `⏱ 체크 주기: ${CONFIG.checkIntervalMinutes}분\n` +
    `🕐 장 시간 제한: ${CONFIG.marketHoursOnly ? '활성 (미국 동부 09:30~16:00)' : '비활성 (24시간)'}`;
  await sendMessage(message);
}
