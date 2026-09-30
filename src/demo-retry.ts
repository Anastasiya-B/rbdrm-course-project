import 'reflect-metadata';

import { QueryRunner } from 'typeorm';

import AppDataSource from './data-source';

const USER_ID = '1';
const INITIAL_BALANCE = 1000000;
const INCREMENT = 1000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 50;

interface BalanceRow {
  balance: number;
}

interface DatabaseError {
  code?: string;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const databaseError = error as DatabaseError;

  return databaseError.code === '40001' || databaseError.code === '40P01';
}

async function runWithRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableError(error)) {
        throw error;
      }

      attempt += 1;

      if (attempt > MAX_RETRIES) {
        throw error;
      }

      const databaseError = error as DatabaseError;

      const backoffMs = BASE_BACKOFF_MS * attempt;

      console.log(
        `${operationName}: caught ${databaseError.code}, retry ${attempt}/${MAX_RETRIES} after ${backoffMs} ms`,
      );

      await sleep(backoffMs);
    }
  }
}

async function incrementBalance(operationName: string): Promise<void> {
  await runWithRetry(operationName, async () => {
    const queryRunner = AppDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const rows = (await queryRunner.query(
        `
              SELECT balance
              FROM users
              WHERE id = $1
            `,
        [USER_ID],
      )) as BalanceRow[];

      const currentBalance = Number(rows[0]?.balance);

      if (!Number.isFinite(currentBalance)) {
        throw new Error('Failed to read user balance');
      }

      await sleep(100);

      const newBalance = currentBalance + INCREMENT;

      await queryRunner.query(
        `
            UPDATE users
            SET balance = $1
            WHERE id = $2
          `,
        [newBalance, USER_ID],
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  });
}

async function resetState(): Promise<void> {
  await AppDataSource.query(
    `
      UPDATE users
      SET balance = $1
      WHERE id = $2
    `,
    [INITIAL_BALANCE, USER_ID],
  );
}

async function getFinalBalance(): Promise<number> {
  const rows = (await AppDataSource.query(
    `
        SELECT balance
        FROM users
        WHERE id = $1
      `,
    [USER_ID],
  )) as BalanceRow[];

  return Number(rows[0]?.balance);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    await resetState();

    console.log('\n=== Retry demo ===');

    await Promise.all([
      incrementBalance('transaction-1'),
      incrementBalance('transaction-2'),
    ]);

    const finalBalance = await getFinalBalance();

    const expectedBalance = INITIAL_BALANCE + INCREMENT * 2;

    console.log(`Initial balance: ${INITIAL_BALANCE}`);
    console.log(`Increment per transaction: ${INCREMENT}`);
    console.log(`Expected final balance: ${expectedBalance}`);
    console.log(`Actual final balance: ${finalBalance}`);

    const invariantPassed = finalBalance === expectedBalance;

    console.log(`Invariant passed: ${invariantPassed}`);

    if (!invariantPassed) {
      process.exitCode = 1;
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('Retry demo failed:', error);

  process.exit(1);
});
