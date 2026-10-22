import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ProductRepository } from '../../src/repositories/product.repository';
import { UserRepository } from '../../src/repositories/user.repository';
import { aProduct, aUser } from '../integration/testkit/builders';
import {
  IntegrationDatabase,
  startIntegrationDatabase,
  stopIntegrationDatabase,
} from '../integration/testkit/postgres';

describe('Orders E2E', () => {
  let database: IntegrationDatabase;
  let app: INestApplication;
  let productId: string;

  beforeAll(async () => {
    database = await startIntegrationDatabase();

    const userRepository = new UserRepository(database.pool);
    const productRepository = new ProductRepository(database.pool);

    const user = await userRepository.create(
      aUser({
        balance: 10000000,
      }),
    );

    const product = await productRepository.create(
      aProduct(user.id, {
        name: 'E2E Mechanical Keyboard',
        price: 260000,
        stockQuantity: 10,
      }),
    );

    productId = product.id;

    process.env.DB_URL = database.container.getConnectionUri();
    process.env.DB_PASSWORD_FILE = 'secrets/db_password';
    process.env.PORT = '3000';

    const { AppModule } = await import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.init();
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
      .expect(200);

    expect(readResponse.body).toEqual(createResponse.body);
  });

  it('returns 404 for a missing order', async () => {
    await request(app.getHttpServer()).get('/orders/999999').expect(404);
  });
});
