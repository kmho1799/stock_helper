import { CONFIG } from './config.js';

const TELEGRAM_MAX_LENGTH = 4096;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

let telegramReady = false;

function sanitizeHtmlMessage(message: string): string {
  return message
    .replace(/<=/g, '&lt;=')
    .replace(/>=/g, '&gt;=')
    .replace(/ < /g, ' &lt; ')
    .replace(/ > /g, ' &gt; ');
}

function splitMessage(message: string, maxLength: number): string[] {
  if (message.length <= maxLength) return [message];

  const chunks: string[] = [];
  const lines = message.split('\n');
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      if (current.length > 0) {
        chunks.push(current);
        current = '';
      }
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        continue;
      }
    }
    current += (current.length > 0 ? '\n' : '') + line;
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegramApiCall(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CONFIG.telegramChatId,
      text,
      parse_mode: 'HTML',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

export function initTelegram(): boolean {
  if (!CONFIG.telegramBotToken || CONFIG.telegramBotToken === 'your_bot_token_here') {
    console.warn('[Telegram] \uBD07 \uD1A0\uD070\uC774 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. .env \uD30C\uC77C\uC744 \uD655\uC778\uD558\uC138\uC694.');
    return false;
  }
  if (!CONFIG.telegramChatId || CONFIG.telegramChatId === 'your_chat_id_here') {
    console.warn('[Telegram] Chat ID\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. .env \uD30C\uC77C\uC744 \uD655\uC778\uD558\uC138\uC694.');
    return false;
  }

  telegramReady = true;
  console.log('[Telegram] \uCD08\uAE30\uD654 \uC644\uB8CC (fetch \uAE30\uBC18)');
  return true;
}

export async function sendMessage(message: string): Promise<void> {
  if (!telegramReady) {
    console.log('[Telegram \uBBF8\uC124\uC815] \uBA54\uC138\uC9C0:', message);
    return;
  }

  const sanitizedMessage = sanitizeHtmlMessage(message);
  const chunks = splitMessage(sanitizedMessage, TELEGRAM_MAX_LENGTH);

  for (let i = 0; i < chunks.length; i++) {
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await telegramApiCall(chunks[i]);
        if (chunks.length > 1) {
          console.log(`[Telegram] \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC644\uB8CC (${i + 1}/${chunks.length})`);
        } else {
          console.log('[Telegram] \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC644\uB8CC');
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          console.warn(`[Telegram] \uC804\uC1A1 \uC2E4\uD328, ${attempt}/${MAX_RETRIES} \uC7AC\uC2DC\uB3C4 \uC911...`);
          await delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    if (lastErr) {
      console.error(`[Telegram] \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uCD5C\uC885 \uC2E4\uD328 (${i + 1}/${chunks.length}):`, lastErr);
    }
  }
}

export async function sendStartupMessage(): Promise<void> {
  const stocks = ['NVDA', 'TSLA'];
  const message =
    `[START] <b>\uC8FC\uC2DD \uBAA8\uB2C8\uD130\uB9C1 \uC2DC\uC791</b>\n\n` +
    `[STOCKS] ${stocks.join(', ')}\n` +
    `[INTERVAL] ${CONFIG.checkIntervalMinutes}\uBD84\n` +
    `[MARKET] ${CONFIG.marketHoursOnly ? '\uD65C\uC131 (\uBBF8\uAD6D \uB3D9\uBD80 09:30~16:00)' : '\uBE44\uD65C\uC131 (24\uC2DC\uAC04)'}`;
  await sendMessage(message);
}
