import { randomUUID } from 'node:crypto';

import {
  closeSessionRedis,
  createSession,
  deleteSession,
  getSession,
  getSessionRedis,
  getSessionTtl,
} from './redis/session';

const REQUESTS = 3;
const WAIT_MS = 1500;

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const sessionId = randomUUID();

  let requests = 0;

  try {
    const redis = getSessionRedis();

    await deleteSession(sessionId);

    await createSession(sessionId, 1);

    const sessionIds = new Set<string>();

    const first = await getSession(sessionId);

    requests += 1;

    if (!first) {
      throw new Error('Session missing after creation');
    }

    sessionIds.add(first.sessionId);

    const ttlBeforeWait = await getSessionTtl(sessionId);

    await sleep(WAIT_MS);

    const ttlAfterWait = await getSessionTtl(sessionId);

    const second = await getSession(sessionId);

    requests += 1;

    if (!second) {
      throw new Error('Session expired before activity');
    }

    sessionIds.add(second.sessionId);

    const ttlAfterRenew = await getSessionTtl(sessionId);

    await sleep(WAIT_MS);

    const third = await getSession(sessionId);

    requests += 1;

    if (!third) {
      throw new Error('Session missing after renewal');
    }

    sessionIds.add(third.sessionId);

    const exists = await redis.exists(`session:${sessionId}`);

    const sessions = sessionIds.size;

    const inRedis = exists === 1 ? 1 : 0;

    const ttlRenewed = ttlAfterRenew > ttlAfterWait ? 1 : 0;

    console.log(`requests=${requests}`);
    console.log(`sessions=${sessions}`);
    console.log(`in-redis=${inRedis}`);
    console.log(`ttl-renewed=${ttlRenewed}`);

    const passed =
      requests >= 3 &&
      sessions === 1 &&
      inRedis === 1 &&
      ttlRenewed === 1 &&
      ttlBeforeWait > 0;

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await deleteSession(sessionId);

    await closeSessionRedis();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
