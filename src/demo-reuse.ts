import { NestFactory } from '@nestjs/core';
import request from 'supertest';

import { AppModule } from './app.module';
import AppDataSource from './data-source';

const USER_ID = 1;

async function ensureDataSource(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

async function cleanAuthState(): Promise<void> {
  await ensureDataSource();

  await AppDataSource.query(
    `
      DELETE FROM refresh_tokens
      WHERE user_id = $1
    `,
    [USER_ID],
  );

  await AppDataSource.query(`
    DELETE FROM access_token_denylist
  `);
}

async function main(): Promise<void> {
  await cleanAuthState();

  const app = await NestFactory.create(AppModule, {
    logger: false,
  });

  await app.init();

  try {
    const http = app.getHttpServer();

    const loginResponse = await request(http).post('/auth/login').send({
      email: 'anna@example.com',
      password: 'Password123!',
    });

    const login = loginResponse.status;

    const r1 = loginResponse.body.refreshToken as string;

    const firstRefreshResponse = await request(http)
      .post('/auth/refresh')
      .send({
        refreshToken: r1,
      });

    const r1Refresh = firstRefreshResponse.status;

    const r2 = firstRefreshResponse.body.refreshToken as string;

    const reuseResponse = await request(http).post('/auth/refresh').send({
      refreshToken: r1,
    });

    const r1Reuse = reuseResponse.status;

    const r2AfterReuseResponse = await request(http)
      .post('/auth/refresh')
      .send({
        refreshToken: r2,
      });

    const r2AfterReuse = r2AfterReuseResponse.status;

    console.log(`login=${login}`);
    console.log(`r1-refresh=${r1Refresh}`);
    console.log(`r1-reuse=${r1Reuse}`);
    console.log(`r2-after-reuse=${r2AfterReuse}`);

    const passed =
      login === 200 &&
      r1Refresh === 200 &&
      r1Reuse === 401 &&
      r2AfterReuse === 401;

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    await cleanAuthState();

    await app.close();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
