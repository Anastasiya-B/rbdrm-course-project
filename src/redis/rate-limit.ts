import Redis from 'ioredis';

const WINDOW_MS = 5_000;

const SLIDING_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local member = ARGV[4]

  redis.call(
    'ZREMRANGEBYSCORE',
    key,
    0,
    now - window
  )

  local count =
    redis.call('ZCARD', key)

  if count >= limit then
    local oldest =
      redis.call(
        'ZRANGE',
        key,
        0,
        0,
        'WITHSCORES'
      )

    local retryAfter = 1

    if oldest[2] then
      local retryMs =
        window -
        (now - tonumber(oldest[2]))

      retryAfter =
        math.max(
          1,
          math.ceil(retryMs / 1000)
        )
    end

    return {
      0,
      count,
      retryAfter
    }
  end

  redis.call(
    'ZADD',
    key,
    now,
    member
  )

  redis.call(
    'PEXPIRE',
    key,
    window
  )

  return {
    1,
    count + 1,
    0
  }
`;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

export class RedisRateLimiter {
  private readonly redis: Redis;

  constructor(
    private readonly instanceName: string,
    private readonly limit: number,
  ) {
    const url = process.env.REDIS_QUEUE_URL;

    if (!url) {
      throw new Error('REDIS_QUEUE_URL is required');
    }

    this.redis = new Redis(url, {
      maxRetriesPerRequest: 2,
    });
  }

  async check(clientId: string): Promise<RateLimitResult> {
    const now = Date.now();

    const member = `${this.instanceName}:${now}:${Math.random()}`;

    const result = (await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      `rate-limit:${clientId}`,
      now,
      WINDOW_MS,
      this.limit,
      member,
    )) as [number, number, number];

    return {
      allowed: result[0] === 1,
      count: Number(result[1]),
      retryAfterSeconds: Number(result[2]),
    };
  }

  async reset(clientId: string): Promise<void> {
    await this.redis.del(`rate-limit:${clientId}`);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
