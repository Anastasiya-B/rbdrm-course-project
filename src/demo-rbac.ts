import { NestFactory } from '@nestjs/core';
import request from 'supertest';

import { AppModule } from './app.module';
import AppDataSource from './data-source';

const BUYER_ID = 1;
const SELLER_ID = 2;

const DEMO_PRODUCT_NAME = 'HW24 RBAC Demo Product';

function tamperRole(token: string): string {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid JWT');
  }

  const payload = JSON.parse(
    Buffer.from(parts[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  payload.role = 'admin';

  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return parts.join('.');
}

async function ensureDataSource(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

async function cleanState(): Promise<void> {
  await ensureDataSource();

  await AppDataSource.query(
    `
      DELETE FROM refresh_tokens
      WHERE user_id IN ($1, $2)
    `,
    [BUYER_ID, SELLER_ID],
  );

  await AppDataSource.query(`
    DELETE FROM access_token_denylist
  `);

  await AppDataSource.query(
    `
      DELETE FROM products
      WHERE name = $1
    `,
    [DEMO_PRODUCT_NAME],
  );
}

async function login(
  http: Parameters<typeof request>[0],
  email: string,
): Promise<string> {
  const response = await request(http).post('/auth/login').send({
    email,
    password: 'Password123!',
  });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status}`);
  }

  return response.body.accessToken as string;
}

async function main(): Promise<void> {
  await cleanState();

  const app = await NestFactory.create(AppModule, {
    logger: false,
  });

  await app.init();

  try {
    const http = app.getHttpServer();

    const buyerAccess = await login(http, 'anna@example.com');

    const sellerAccess = await login(http, 'oleh@example.com');

    const anonResponse = await request(http).get('/orders/1');

    const anon = anonResponse.status;

    const ownResponse = await request(http)
      .get('/orders/1')
      .set('Authorization', `Bearer ${buyerAccess}`);

    const own = ownResponse.status;

    const foreignResponse = await request(http)
      .get('/orders/2')
      .set('Authorization', `Bearer ${buyerAccess}`);

    const foreign = foreignResponse.status;

    const productBody = {
      name: DEMO_PRODUCT_NAME,
      description: 'HW24 RBAC demo',
      price: 10000,
      stockQuantity: 1,
    };

    const roleDeniedResponse = await request(http)
      .post('/products')
      .set('Authorization', `Bearer ${buyerAccess}`)
      .send(productBody);

    const roleDenied = roleDeniedResponse.status;

    const roleAllowedResponse = await request(http)
      .post('/products')
      .set('Authorization', `Bearer ${sellerAccess}`)
      .send(productBody);

    const roleAllowed = roleAllowedResponse.status;

    const tamperedToken = tamperRole(buyerAccess);

    const tamperedResponse = await request(http)
      .post('/products')
      .set('Authorization', `Bearer ${tamperedToken}`)
      .send({
        ...productBody,
        name: `${DEMO_PRODUCT_NAME} Tampered`,
      });

    const tampered = tamperedResponse.status;

    console.log(`anon=${anon}`);
    console.log(`own=${own}`);
    console.log(`foreign=${foreign}`);
    console.log(`role-denied=${roleDenied}`);
    console.log(`role-allowed=${roleAllowed}`);
    console.log(`tampered=${tampered}`);

    const passed =
      anon === 401 &&
      own === 200 &&
      foreign === 403 &&
      roleDenied === 403 &&
      (roleAllowed === 200 || roleAllowed === 201) &&
      tampered === 401;

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    await cleanState();

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
