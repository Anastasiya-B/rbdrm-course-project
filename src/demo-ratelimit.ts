import { RedisRateLimiter } from './redis/rate-limit';

const LIMIT = 5;
const CLIENT_ID = 'hw23-shared-client';

async function main(): Promise<void> {
  const limiterA = new RedisRateLimiter('instance-a', LIMIT);

  const limiterB = new RedisRateLimiter('instance-b', LIMIT);

  let allowed = 0;
  let blocked = 0;
  let status = 200;
  let retryAfter = 0;

  try {
    await limiterA.reset(CLIENT_ID);

    const instances = 2;

    const limiters = [limiterA, limiterB];

    for (let index = 0; index < LIMIT + 3; index += 1) {
      const limiter = limiters[index % limiters.length];

      const result = await limiter.check(CLIENT_ID);

      if (result.allowed) {
        allowed += 1;
        status = 200;
        continue;
      }

      blocked += 1;
      status = 429;
      retryAfter = result.retryAfterSeconds > 0 ? 1 : 0;
    }

    console.log(`instances=${instances}`);
    console.log(`limit=${LIMIT}`);
    console.log(`requests=${LIMIT + 3}`);
    console.log(`allowed=${allowed}`);
    console.log(`blocked=${blocked}`);
    console.log(`status=${status}`);
    console.log(`retry-after=${retryAfter}`);

    const passed =
      instances >= 2 &&
      allowed === LIMIT &&
      blocked >= 1 &&
      status === 429 &&
      retryAfter === 1;

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await limiterA.close();
    await limiterB.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
