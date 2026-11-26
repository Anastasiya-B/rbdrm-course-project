import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Verifier } from '@pact-foundation/pact';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { signAccessToken } from '../../../src/auth/auth.tokens';
import type { RequestHandler } from 'express';

import {
  IntegrationDatabase,
  startIntegrationDatabase,
  stopIntegrationDatabase,
} from '../../integration/testkit/postgres';

describe('MarketplaceAPI provider verification', () => {
  let database: IntegrationDatabase;
  let app: INestApplication;
  let providerBaseUrl: string;
  let contractToken: string;

  beforeAll(async () => {
    database = await startIntegrationDatabase();

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
    process.env.JWT_KID = 'pact-key';
    process.env.JWT_PRIVATE_KEY = Buffer.from(
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ).toString('base64');
    process.env.JWT_PUBLIC_KEY = Buffer.from(
      keys.publicKey.export({ type: 'spki', format: 'pem' }),
    ).toString('base64');
    process.env.REFRESH_TOKEN_PEPPER = 'pact-pepper';

    const { AppModule } = await import('../../../src/app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.listen(0, '127.0.0.1');

    contractToken = signAccessToken(1, 'buyer', 'pact-family').token;

    const address = app.getHttpServer().address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve provider server port');
    }

    providerBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (database) {
      await stopIntegrationDatabase(database);
    }
  });

  it('verifies the orders pact', async () => {
    const brokerUrl = process.env.PACT_BROKER_URL;
    const brokerToken = process.env.PACT_BROKER_TOKEN;

    const stateHandlers = {
      'order 1 exists': async () => {
        await database.pool.query(`
          INSERT INTO users (
            id,
            email,
            full_name,
            balance
          )
          VALUES (
            1,
            'pact-user@example.com',
            'Pact User',
            10000000
          )
          ON CONFLICT (id) DO UPDATE
          SET
            email = EXCLUDED.email,
            full_name = EXCLUDED.full_name,
            balance = EXCLUDED.balance
        `);

        await database.pool.query(`
          INSERT INTO products (
            id,
            owner_id,
            name,
            description,
            price,
            stock_quantity,
            is_active
          )
          VALUES (
            1,
            1,
            'Mechanical Keyboard',
            'Pact provider product',
            260000,
            10,
            TRUE
          )
          ON CONFLICT (id) DO UPDATE
          SET
            owner_id = EXCLUDED.owner_id,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            price = EXCLUDED.price,
            stock_quantity = EXCLUDED.stock_quantity,
            is_active = EXCLUDED.is_active
        `);

        await database.pool.query(`
          INSERT INTO orders (
            id,
            user_id,
            status,
            total_amount
          )
          VALUES (
            1,
            1,
            'created',
            520000
          )
          ON CONFLICT (id) DO UPDATE
          SET
            user_id = EXCLUDED.user_id,
            status = EXCLUDED.status,
            total_amount = EXCLUDED.total_amount
        `);

        await database.pool.query(`
          INSERT INTO order_items (
            id,
            order_id,
            product_id,
            quantity,
            unit_price
          )
          VALUES (
            1,
            1,
            1,
            2,
            260000
          )
          ON CONFLICT (id) DO UPDATE
          SET
            order_id = EXCLUDED.order_id,
            product_id = EXCLUDED.product_id,
            quantity = EXCLUDED.quantity,
            unit_price = EXCLUDED.unit_price
        `);
      },
    };

    const localOptions = {
      provider: 'MarketplaceAPI',
      providerBaseUrl,
      pactUrls: [
        path.resolve(
          process.cwd(),
          'pacts/MarketplaceFrontend-MarketplaceAPI.json',
        ),
      ],
      stateHandlers,
      logLevel: 'info' as const,
      requestFilter: ((request, _response, next) => {
        request.headers.authorization = `Bearer ${contractToken}`;
        next();
      }) satisfies RequestHandler,
    };

    const brokerOptions = {
      provider: 'MarketplaceAPI',
      providerBaseUrl,
      pactBrokerUrl: brokerUrl,
      providerVersion: process.env.PACT_PROVIDER_VERSION ?? 'hw16-provider-1',
      publishVerificationResult: true,
      consumerVersionSelectors: [
        {
          latest: true,
        },
      ],
      stateHandlers,
      logLevel: 'info' as const,
      ...(brokerToken
        ? {
            pactBrokerToken: brokerToken,
          }
        : {}),
    };

    const verifier = new Verifier(brokerUrl ? brokerOptions : localOptions);

    await verifier.verifyProvider();
  });
});
