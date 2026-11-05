import { Job, Queue, Worker } from 'bullmq';

import { getQueueRedis, getQueueWorkerRedis } from './redis/queue';

const QUEUE_NAME = 'hw23-demo-queue';
const JOB_ID = 'hw23-deduplicated-job';
const SCHEDULER_ID = 'hw23-demo-scheduler';

const WAIT_TIMEOUT_MS = 15_000;

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    if (await predicate()) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for BullMQ demo');
}

async function main(): Promise<void> {
  const queueConnection = getQueueRedis();

  const workerConnection = getQueueWorkerRedis();

  const queue = new Queue(QUEUE_NAME, {
    connection: queueConnection,
  });

  let attempts = 0;
  let completed = 0;
  let scheduledRuns = 0;

  let worker: Worker | undefined;

  try {
    await queue.obliterate({
      force: true,
    });

    const policyResult = await queueConnection.config(
      'GET',
      'maxmemory-policy',
    );

    const policy = Array.isArray(policyResult)
      ? String(policyResult[1] ?? '')
      : '';

    const queueNoeviction = policy === 'noeviction' ? 1 : 0;

    let added = 0;

    await queue.add(
      'retriable-job',
      {
        demo: true,
      },
      {
        jobId: JOB_ID,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 100,
          jitter: 0.5,
        },
        removeOnComplete: {
          age: 3600,
        },
        removeOnFail: false,
      },
    );

    added += 1;

    await queue.add(
      'retriable-job',
      {
        demo: true,
      },
      {
        jobId: JOB_ID,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 100,
          jitter: 0.5,
        },
        removeOnComplete: {
          age: 3600,
        },
        removeOnFail: false,
      },
    );

    added += 1;

    const deduplicatedJobs = await queue.getJobs([
      'waiting',
      'delayed',
      'active',
      'completed',
      'failed',
    ]);

    const queued = deduplicatedJobs.filter(job => job.id === JOB_ID).length;

    await queue.upsertJobScheduler(
      SCHEDULER_ID,
      {
        every: 500,
      },
      {
        name: 'scheduled-job',
        data: {
          demo: true,
        },
        opts: {
          removeOnComplete: {
            age: 3600,
          },
        },
      },
    );

    const schedulers = (await queue.getJobSchedulers()).length;

    worker = new Worker(
      QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === 'scheduled-job') {
          scheduledRuns += 1;

          return;
        }

        if (job.id === JOB_ID) {
          attempts += 1;

          if (attempts < 3) {
            throw new Error(`Intentional failure ${attempts}`);
          }

          completed += 1;
        }
      },
      {
        connection: workerConnection,
        concurrency: 1,
      },
    );

    await worker.waitUntilReady();

    await waitFor(
      async () => completed === 1 && attempts >= 3 && scheduledRuns >= 2,
    );

    console.log(`queue-noeviction=${queueNoeviction}`);
    console.log(`attempts=${attempts}`);
    console.log(`completed=${completed}`);
    console.log(`added=${added}`);
    console.log(`queued=${queued}`);
    console.log(`schedulers=${schedulers}`);
    console.log(`scheduled-runs=${scheduledRuns}`);

    const passed =
      queueNoeviction === 1 &&
      attempts >= 3 &&
      completed === 1 &&
      added === 2 &&
      queued === 1 &&
      schedulers >= 1 &&
      scheduledRuns >= 2;

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    try {
      await queue.removeJobScheduler(SCHEDULER_ID);
    } catch {
      // Demo cleanup.
    }

    if (worker) {
      await worker.close();
    }

    await queue.close();

    if (queueConnection.status !== 'end') {
      await queueConnection.quit();
    }

    if (workerConnection.status !== 'end') {
      await workerConnection.quit();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
