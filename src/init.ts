import 'reflect-metadata';

import AppDataSource from './data-source';
import { seed } from './seed';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await AppDataSource.runMigrations({ transaction: 'all' });
    await seed();
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch(error => {
  console.error('Database initialization failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
