import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool, PoolClient } from 'pg';
import { DataSource } from 'typeorm';

import {
  Order,
  OrderItem,
  PostProcessingTask,
  Product,
  User,
} from '../../../src/entities';
import { AddCheckoutConcurrency1790758800000 } from '../../../src/migrations/1790758800000-AddCheckoutConcurrency';
import { InitialSchema1790585877116 } from '../../../src/migrations/1790585877116-InitialSchema';

export interface IntegrationDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}

export async function startIntegrationDatabase(): Promise<IntegrationDatabase> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const dataSource = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    entities: [User, Product, Order, OrderItem, PostProcessingTask],
    migrations: [
      InitialSchema1790585877116,
      AddCheckoutConcurrency1790758800000,
    ],
    synchronize: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

  const pool = new Pool({
    connectionString: container.getConnectionUri(),
  });

  return {
    container,
    pool,
  };
}

export async function startTestTransaction(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query('BEGIN');

  return client;
}

export async function rollbackTestTransaction(
  client: PoolClient,
): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

export async function stopIntegrationDatabase(
  database: IntegrationDatabase,
): Promise<void> {
  await database.pool.end();
  await database.container.stop();
}
