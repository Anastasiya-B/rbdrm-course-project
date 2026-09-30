import 'reflect-metadata';

import { QueryRunner } from 'typeorm';

import AppDataSource from './data-source';

const WORKER_COUNT = 3;
const PROCESSING_DELAY_MS = 200;

interface TaskRow {
  id: string;
  order_id: string;
}

interface CountRow {
  count: string;
}

interface WorkerResult {
  workerId: string;
  processed: number;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function claimAndProcessTask(workerId: string): Promise<boolean> {
  const queryRunner = AppDataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const taskRows = (await queryRunner.query(
      `
        SELECT id, order_id
        FROM post_processing_tasks
        WHERE status = 'pending'
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
    )) as TaskRow[];

    const task = taskRows[0];

    if (!task) {
      await queryRunner.rollbackTransaction();

      return false;
    }

    await sleep(PROCESSING_DELAY_MS);

    await queryRunner.query(
      `
        UPDATE post_processing_tasks
        SET status = 'done',
            processed = processed + 1,
            worker_id = $1,
            processed_at = NOW()
        WHERE id = $2
      `,
      [workerId, task.id],
    );

    await queryRunner.commitTransaction();

    return true;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function hasPendingTasks(queryRunner: QueryRunner): Promise<boolean> {
  const rows = (await queryRunner.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM post_processing_tasks
        WHERE status = 'pending'
      ) AS has_pending
    `,
  )) as Array<{ has_pending: boolean }>;

  return rows[0]?.has_pending ?? false;
}

async function runWorker(workerId: string): Promise<WorkerResult> {
  let processed = 0;

  while (true) {
    const handled = await claimAndProcessTask(workerId);

    if (handled) {
      processed += 1;
      continue;
    }

    const queryRunner = AppDataSource.createQueryRunner();

    await queryRunner.connect();

    try {
      const pending = await hasPendingTasks(queryRunner);

      if (!pending) {
        break;
      }
    } finally {
      await queryRunner.release();
    }

    await sleep(25);
  }

  return {
    workerId,
    processed,
  };
}

async function resetTasks(): Promise<number> {
  await AppDataSource.query(`
    UPDATE post_processing_tasks
    SET status = 'pending',
        processed = 0,
        worker_id = NULL,
        processed_at = NULL
  `);

  const rows = (await AppDataSource.query(`
    SELECT COUNT(*) AS count
    FROM post_processing_tasks
  `)) as CountRow[];

  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const taskCount = await resetTasks();

    if (taskCount === 0) {
      throw new Error('No post-processing tasks found. Run demo:race first.');
    }

    const sequentialTime = taskCount * PROCESSING_DELAY_MS;

    const startedAt = Date.now();

    const workers = Array.from({ length: WORKER_COUNT }, (_, index) =>
      runWorker(`worker-${index + 1}`),
    );

    const results = await Promise.all(workers);

    const elapsedMs = Date.now() - startedAt;

    const duplicateRows = (await AppDataSource.query(`
        SELECT COUNT(*) AS count
        FROM post_processing_tasks
        WHERE processed > 1
      `)) as CountRow[];

    const processedTwice = Number(duplicateRows[0]?.count ?? 0);

    const processedRows = (await AppDataSource.query(`
        SELECT COUNT(*) AS count
        FROM post_processing_tasks
        WHERE status = 'done'
          AND processed = 1
      `)) as CountRow[];

    const processedOnce = Number(processedRows[0]?.count ?? 0);

    console.log('\n=== Worker pool result ===');

    for (const result of results) {
      console.log(`${result.workerId}: ${result.processed}`);
    }

    console.log(`Total tasks: ${taskCount}`);
    console.log(`Processed once: ${processedOnce}`);
    console.log(`Processed twice: ${processedTwice}`);
    console.log(`Elapsed: ${elapsedMs} ms`);
    console.log(`Sequential estimate: ${sequentialTime} ms`);

    const activeWorkers = results.filter(result => result.processed > 0).length;

    const invariantPassed =
      processedOnce === taskCount &&
      processedTwice === 0 &&
      activeWorkers >= 2 &&
      elapsedMs < sequentialTime;

    console.log(`Active workers: ${activeWorkers}`);
    console.log(`Invariant passed: ${invariantPassed}`);

    if (!invariantPassed) {
      process.exitCode = 1;
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('Worker demo failed:', error);

  process.exit(1);
});
