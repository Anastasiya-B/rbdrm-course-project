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

    const access1 = loginResponse.body.accessToken as string;

    const refresh1 = loginResponse.body.refreshToken as string;

    const noTokenResponse = await request(http).get('/orders/1');

    const noToken = noTokenResponse.status;

    const withTokenResponse = await request(http)
      .get('/orders/1')
      .set('Authorization', `Bearer ${access1}`);

    const withToken = withTokenResponse.status;

    const refreshResponse = await request(http).post('/auth/refresh').send({
      refreshToken: refresh1,
    });

    const refresh = refreshResponse.status;

    const access2 = refreshResponse.body.accessToken as string;

    const refresh2 = refreshResponse.body.refreshToken as string;

    const logoutResponse = await request(http)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access2}`)
      .send({
        refreshToken: refresh2,
      });

    const logout = logoutResponse.status;

    const afterLogoutResponse = await request(http)
      .get('/orders/1')
      .set('Authorization', `Bearer ${access2}`);

    const afterLogout = afterLogoutResponse.status;

    const refreshAfterLogoutResponse = await request(http)
      .post('/auth/refresh')
      .send({
        refreshToken: refresh2,
      });

    const refreshAfterLogout = refreshAfterLogoutResponse.status;

    console.log(`login=${login}`);
    console.log(`no-token=${noToken}`);
    console.log(`with-token=${withToken}`);
    console.log(`refresh=${refresh}`);
    console.log(`logout=${logout}`);
    console.log(`after-logout=${afterLogout}`);
    console.log(`refresh-after-logout=${refreshAfterLogout}`);

    const passed =
      login === 200 &&
      noToken === 401 &&
      withToken === 200 &&
      refresh === 200 &&
      (logout === 200 || logout === 204) &&
      afterLogout === 401 &&
      refreshAfterLogout === 401;

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
