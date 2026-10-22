import AppDataSource from '../data-source';
import { relayOutboxBatch } from './outbox-relay';

async function main(): Promise<void> {
  try {
    const stats = await relayOutboxBatch();

    console.log(`selected=${stats.selected}`);
    console.log(`published=${stats.published}`);
    console.log(`marked=${stats.markedPublished}`);
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
