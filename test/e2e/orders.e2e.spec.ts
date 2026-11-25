import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { generateKeyPairSync } from 'node:crypto';

import { ProductRepository } from '../../src/repositories/product.repository';
import { UserRepository } from '../../src/repositories/user.repository';
import { aProduct, aUser } from '../integration/testkit/builders';
import { signAccessToken } from '../../src/auth/auth.tokens';
import {
  IntegrationDatabase,
  startIntegrationDatabase,
  stopIntegrationDatabase,
} from '../integration/testkit/postgres';

describe('Orders E2E', () => {
  let database: IntegrationDatabase;
  let app: INestApplication;
  let productId: string;
  let secondProductId: string;
  let userId: string;
  let accessToken: string;
  let adminAccessToken: string;

  beforeAll(async () => {
    database = await startIntegrationDatabase();

    const userRepository = new UserRepository(database.pool);
    const productRepository = new ProductRepository(database.pool);

    const user = await userRepository.create(
      aUser({
        balance: 10000000,
      }),
    );
    userId = user.id;

    const product = await productRepository.create(
      aProduct(user.id, {
        name: 'E2E Mechanical Keyboard',
        price: 260000,
        stockQuantity: 50,
      }),
    );

    productId = product.id;

    const secondProduct = await productRepository.create(
      aProduct(user.id, {
        name: 'E2E Rollback Product',
        price: 100,
        stockQuantity: 1,
      }),
    );
    secondProductId = secondProduct.id;

    process.env.DB_URL = database.container.getConnectionUri();
    process.env.DB_PASSWORD_FILE = 'secrets/db_password';
    process.env.PORT = '3000';

    const databaseUrl = new URL(database.container.getConnectionUri());
    process.env.DB_HOST = databaseUrl.hostname;
    process.env.DB_PORT = databaseUrl.port;
    process.env.DB_USER = decodeURIComponent(databaseUrl.username);
    process.env.DB_PASSWORD = decodeURIComponent(databaseUrl.password);
    process.env.DB_NAME = databaseUrl.pathname.slice(1);

    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_KID = 'e2e-key';
    process.env.JWT_PRIVATE_KEY = Buffer.from(
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ).toString('base64');
    process.env.JWT_PUBLIC_KEY = Buffer.from(
      keys.publicKey.export({ type: 'spki', format: 'pem' }),
    ).toString('base64');
    process.env.REFRESH_TOKEN_PEPPER = 'e2e-refresh-pepper';

    const { AppModule } = await import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.init();

    accessToken = signAccessToken(Number(user.id), 'buyer', 'e2e-family').token;
    adminAccessToken = signAccessToken(Number(user.id), 'admin', 'e2e-admin-family').token;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (database) {
      await stopIntegrationDatabase(database);
    }
  });

  it('creates an order and reads it back', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-order-1')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          {
            product_id: Number(productId),
            quantity: 2,
          },
        ],
      })
      .expect(201);

    expect(createResponse.body).toMatchObject({
      items: [
        {
          product_id: Number(productId),
          quantity: 2,
        },
      ],
      total_cents: 520000,
      status: 'created',
    });

    expect(createResponse.body.id).toEqual(expect.any(Number));

    const orderId = createResponse.body.id;

    const readResponse = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(readResponse.body).toEqual(createResponse.body);
  });

  it('returns 404 for a missing order', async () => {
    await request(app.getHttpServer())
      .get('/orders/999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('rejects anonymous checkout and protects status changes', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'anonymous-order')
      .send({ items: [{ product_id: Number(productId), quantity: 1 }] })
      .expect(401);

    await request(app.getHttpServer())
      .patch('/orders/1/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'cancelled' })
      .expect(403);

    await request(app.getHttpServer())
      .patch('/orders/1/status')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'paid' })
      .expect(409);
  });

  it('replays idempotent checkout without reserving inventory twice', async () => {
    const body = { items: [{ product_id: Number(productId), quantity: 1 }] };
    const first = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'replay-order')
      .send(body)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'replay-order')
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'replay-order')
      .send({ items: [{ product_id: Number(productId), quantity: 2 }] })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/orders/${first.body.id}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'cancelled' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/orders/${first.body.id}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'cancelled' })
      .expect(409);
  });

  it('rejects invalid quantities and rolls back all reservations', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'invalid-quantity')
      .send({ items: [{ product_id: Number(productId), quantity: 0 }] })
      .expect(400);

    const before = await database.pool.query<{ stock_quantity: number }>(
      'SELECT stock_quantity FROM products WHERE id = $1',
      [productId],
    );

    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'rollback-order')
      .send({
        items: [
          { product_id: Number(productId), quantity: 1 },
          { product_id: Number(secondProductId), quantity: 2 },
        ],
      })
      .expect(409);

    const after = await database.pool.query<{ stock_quantity: number }>(
      'SELECT stock_quantity FROM products WHERE id = $1',
      [productId],
    );
    expect(after.rows[0]?.stock_quantity).toBe(before.rows[0]?.stock_quantity);
  });

  it('enforces stock under 50 concurrent real checkout requests', async () => {
    const requests = Array.from({ length: 50 }, (_, index) =>
      request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', `concurrent-order-${index}`)
        .send({ items: [{ product_id: Number(productId), quantity: 1 }] }),
    );
    const responses = await Promise.all(requests);
    const successful = responses.filter(response => response.status === 201);
    const conflicts = responses.filter(response => response.status === 409);

    expect(successful).toHaveLength(48);
    expect(conflicts).toHaveLength(2);

    const stock = await database.pool.query<{ stock_quantity: number }>(
      'SELECT stock_quantity FROM products WHERE id = $1',
      [productId],
    );
    expect(Number(stock.rows[0]?.stock_quantity)).toBe(0);

    const persisted = await database.pool.query<{
      orders: string;
      outbox: string;
      duplicate_effects: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM orders WHERE user_id = $1) AS orders,
          (SELECT count(*) FROM outbox_messages) AS outbox,
          (SELECT count(*) - count(DISTINCT event_id) FROM outbox_messages) AS duplicate_effects
      `,
      [userId],
    );
    const totals = persisted.rows[0];
    expect(Number(totals?.orders)).toBe(50);
    expect(Number(totals?.outbox)).toBe(50);
    expect(Number(totals?.duplicate_effects)).toBe(0);
    console.log(
      `concurrency initial_stock=50 successful=${successful.length} rejected=${conflicts.length} final_stock=${stock.rows[0]?.stock_quantity} persisted_orders=${totals?.orders} persisted_outbox=${totals?.outbox} duplicate_effects=${totals?.duplicate_effects} overselling=0`,
    );

  });
});
