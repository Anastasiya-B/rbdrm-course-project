import Redis from 'ioredis';

const SESSION_TTL_SECONDS = 5;

let sessionRedis: Redis | null = null;

export function getSessionRedis(): Redis {
  if (sessionRedis) {
    return sessionRedis;
  }

  const url = process.env.REDIS_QUEUE_URL;

  if (!url) {
    throw new Error('REDIS_QUEUE_URL is required');
  }

  sessionRedis = new Redis(url, {
    maxRetriesPerRequest: 2,
  });

  return sessionRedis;
}

export interface SessionData {
  sessionId: string;
  userId: number;
}

export async function createSession(
  sessionId: string,
  userId: number,
): Promise<void> {
  const redis = getSessionRedis();

  await redis.set(
    `session:${sessionId}`,
    JSON.stringify({
      sessionId,
      userId,
    }),
    'EX',
    SESSION_TTL_SECONDS,
  );
}

export async function getSession(
  sessionId: string,
): Promise<SessionData | null> {
  const redis = getSessionRedis();
  const key = `session:${sessionId}`;

  const value = await redis.get(key);

  if (value === null) {
    return null;
  }

  await redis.expire(key, SESSION_TTL_SECONDS);

  return JSON.parse(value) as SessionData;
}

export async function getSessionTtl(sessionId: string): Promise<number> {
  const redis = getSessionRedis();

  return redis.ttl(`session:${sessionId}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getSessionRedis();

  await redis.del(`session:${sessionId}`);
}

export async function closeSessionRedis(): Promise<void> {
  if (!sessionRedis) {
    return;
  }

  await sessionRedis.quit();
  sessionRedis = null;
}
