import AppDataSource from './data-source';
import { closeCacheRedis, getCacheRedis } from './redis/cache';
import {
  getDatabaseCallCount,
  getProductSummaryCached,
  resetDatabaseCallCount,
} from './redis/product-cache';

const WARM_KEYS = 60;
const CONCURRENT_REQUESTS = 25;
const WARM_READS = 100;

interface IdRow {
  id: string;
}

async function getProductId(): Promise<number> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const rows = (await AppDataSource.query(
    `
      SELECT id
      FROM products
      WHERE is_active = TRUE
      ORDER BY id
      LIMIT 1
    `,
  )) as IdRow[];

  const product = rows[0];

  if (!product) {
    throw new Error('No active product found. Run npm run seed first.');
  }

  return Number(product.id);
}

async function main(): Promise<void> {
  try {
    const redis = getCacheRedis();

    await redis.flushdb();

    const policyResult = await redis.config('GET', 'maxmemory-policy');

    const maxmemoryResult = await redis.config('GET', 'maxmemory');

    const policy = Array.isArray(policyResult)
      ? String(policyResult[1] ?? '')
      : '';

    const maxmemory = Array.isArray(maxmemoryResult)
      ? Number(maxmemoryResult[1] ?? 0)
      : 0;

    const cacheLru = policy === 'allkeys-lru' ? 1 : 0;

    const cacheMaxmemory = maxmemory > 0 ? 1 : 0;

    const ttls: number[] = [];

    for (let index = 0; index < WARM_KEYS; index += 1) {
      const key = `demo:warm:${index}`;

      await redis.set(
        key,
        `value-${index}`,
        'EX',
        300 + Math.floor(Math.random() * 61),
      );

      const ttl = await redis.ttl(key);

      ttls.push(ttl);
    }

    const ttlDistinct = new Set(ttls).size;

    const productId = await getProductId();

    const productKey = `product-summary:${productId}`;

    await redis.del(productKey);

    resetDatabaseCallCount();

    await Promise.all(
      Array.from(
        {
          length: CONCURRENT_REQUESTS,
        },
        () => getProductSummaryCached(productId),
      ),
    );

    const dbCalls = getDatabaseCallCount();

    resetDatabaseCallCount();

    for (let index = 0; index < WARM_READS; index += 1) {
      await getProductSummaryCached(productId);
    }

    const dbCallsWarm = getDatabaseCallCount();

    console.log(`cache-lru=${cacheLru}`);
    console.log(`cache-maxmemory=${cacheMaxmemory}`);
    console.log(`warmed=${WARM_KEYS}`);
    console.log(`ttl-distinct=${ttlDistinct}`);
    console.log(`concurrent=${CONCURRENT_REQUESTS}`);
    console.log(`db-calls=${dbCalls}`);
    console.log(`db-calls-warm=${dbCallsWarm}`);

    const passed =
      cacheLru === 1 &&
      cacheMaxmemory === 1 &&
      WARM_KEYS >= 50 &&
      ttlDistinct >= 5 &&
      CONCURRENT_REQUESTS >= 20 &&
      dbCalls === 1 &&
      dbCallsWarm === 0;

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeCacheRedis();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
