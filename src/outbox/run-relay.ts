import AppDataSource from '../data-source';
import { relayOutboxBatch } from './outbox-relay';
import { sleep } from '../lifecycle';

async function main(): Promise<void> {
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });

  try {
    while (!stopping) {
      const stats = await relayOutboxBatch();
      if (stats.selected > 0) {
        console.log(`selected=${stats.selected} published=${stats.published} marked=${stats.markedPublished}`);
      }
      await sleep(stats.selected > 0 ? 100 : 1000);
    }
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
