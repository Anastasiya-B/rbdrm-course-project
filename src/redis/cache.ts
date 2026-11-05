import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const CACHE_TTL_SECONDS = 300;
const CACHE_TTL_JITTER_SECONDS = 60;
const LOCK_TTL_MS = 5_000;
const LOCK_WAIT_MS = 25;
const LOCK_WAIT_ATTEMPTS = 200;

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end

  return 0
`;

let cacheRedis: Redis | null = null;

export function getCacheRedis(): Redis {
  if (cacheRedis) {
    return cacheRedis;
  }

  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error('REDIS_URL is required');
  }

  cacheRedis = new Redis(url, {
    maxRetriesPerRequest: 2,
  });

  return cacheRedis;
}

export function getCacheTtlSeconds(): number {
  return (
    CACHE_TTL_SECONDS +
    Math.floor(Math.random() * (CACHE_TTL_JITTER_SECONDS + 1))
  );
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const redis = getCacheRedis();
  const value = await redis.get(key);

  if (value === null) {
    return null;
  }

  return JSON.parse(value) as T;
}

export async function setCachedJson(
  key: string,
  value: unknown,
): Promise<number> {
  const redis = getCacheRedis();
  const ttl = getCacheTtlSeconds();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch {
    // Cache failure must not fail the request.
  }

  return ttl;
}

export async function getOrLoadCached<T>(
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await getCachedJson<T>(key);

  if (cached !== null) {
    return cached;
  }

  const redis = getCacheRedis();
  const lockKey = `lock:${key}`;
  const token = randomUUID();

  const locked = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');

  if (locked === 'OK') {
    try {
      const secondCheck = await getCachedJson<T>(key);

      if (secondCheck !== null) {
        return secondCheck;
      }

      const loaded = await loader();

      await setCachedJson(key, loaded);

      return loaded;
    } finally {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
    }
  }

  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, LOCK_WAIT_MS));

    const value = await getCachedJson<T>(key);

    if (value !== null) {
      return value;
    }
  }

  // Lock holder may have died. Correctness does not depend
  // on the cache lock, so fall back to the source.
  const loaded = await loader();

  await setCachedJson(key, loaded);

  return loaded;
}

export async function closeCacheRedis(): Promise<void> {
  if (!cacheRedis) {
    return;
  }

  await cacheRedis.quit();
  cacheRedis = null;
}
