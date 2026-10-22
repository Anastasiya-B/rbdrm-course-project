import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import type { Env } from './config/env.schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService<Env, true>) {
    const databaseUrl = this.configService.get('DB_URL', {
      infer: true,
    });

    const passwordFile = this.configService.get('DB_PASSWORD_FILE', {
      infer: true,
    });

    const url = new URL(databaseUrl);

    const password = url.password
      ? decodeURIComponent(url.password)
      : readFileSync(passwordFile, 'utf8').trim();

    this.pool = new Pool({
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      database: url.pathname.slice(1),
      password,
    });

    this.pool.on('error', error => {
      console.error('Unexpected PostgreSQL pool error:', error.message);
    });
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async checkConnection() {
    const result = await this.pool.query<{ message: string }>(
      'SELECT message FROM health_check LIMIT 1',
    );

    return result.rows[0];
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
