import cron from 'node-cron';
import { STOCKS, CONFIG } from './config.js';
import { fetchStockData, isMarketOpen } from './indicators.js';
import { checkAlerts } from './alertChecker.js';
import { initTelegram, sendStartupMessage } from './telegram.js';

async function runMonitorCycle(): Promise<void> {
  if (CONFIG.marketHoursOnly && !isMarketOpen()) {
    console.log(`[${new Date().toLocaleString('ko-KR')}] 장 시간 외 - 스킵`);
    return;
  }

  console.log(`\n[${new Date().toLocaleString('ko-KR')}] 모니터링 사이클 시작`);

  for (const stock of STOCKS) {
    try {
      console.log(`  [${stock.ticker}] 데이터 수집 중...`);
      const data = await fetchStockData(stock.ticker);

      const rsiDisplay = data.rsi !== null ? data.rsi.toFixed(1) : 'N/A';
      console.log(
        `  [${stock.ticker}] 가격: $${data.currentPrice.toFixed(2)} | ` +
        `일간: ${data.dailyChangePercent >= 0 ? '+' : ''}${data.dailyChangePercent.toFixed(2)}% | ` +
        `RSI: ${rsiDisplay}`
      );

      await checkAlerts(stock, data);
    } catch (err) {
      console.error(`  [${stock.ticker}] 오류 발생:`, err);
    }
  }
}

async function main(): Promise<void> {
  console.log('====================================');
  console.log('  NASDAQ 주식 모니터링 서버 시작');
  console.log('====================================');
  console.log(`추적 종목: ${STOCKS.map((s) => s.ticker).join(', ')}`);
  console.log(`체크 주기: ${CONFIG.checkIntervalMinutes}분`);
  console.log(`장 시간 제한: ${CONFIG.marketHoursOnly ? '활성' : '비활성'}`);
  console.log('====================================\n');

  const telegramReady = initTelegram();
  if (telegramReady) {
    await sendStartupMessage();
  } else {
    console.log('[안내] 텔레그램 미설정 상태 - 콘솔에만 출력합니다.');
    console.log('[안내] .env 파일에 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID를 설정하세요.\n');
  }

  // 시작 시 즉시 1회 실행
  await runMonitorCycle();

  const cronExpression = `*/${CONFIG.checkIntervalMinutes} * * * *`;
  console.log(`\n크론 스케줄 등록: ${cronExpression}`);

  cron.schedule(cronExpression, async () => {
    await runMonitorCycle();
  });

  console.log('모니터링 서버 실행 중... (Ctrl+C 로 종료)\n');
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
