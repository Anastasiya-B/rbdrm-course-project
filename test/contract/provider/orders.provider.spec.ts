import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Verifier } from '@pact-foundation/pact';
import path from 'node:path';

import {
  IntegrationDatabase,
  startIntegrationDatabase,
  stopIntegrationDatabase,
} from '../../integration/testkit/postgres';

describe('MarketplaceAPI provider verification', () => {
  let database: IntegrationDatabase;
  let app: INestApplication;
  let providerBaseUrl: string;

  beforeAll(async () => {
    database = await startIntegrationDatabase();

    process.env.DB_URL = database.container.getConnectionUri();
    process.env.DB_PASSWORD_FILE = 'secrets/db_password';
    process.env.PORT = '3000';

    const { AppModule } = await import('../../../src/app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.listen(0, '127.0.0.1');

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
