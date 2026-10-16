import { describe, expect, it } from '@jest/globals';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import path from 'node:path';

const { integer, like } = MatchersV3;

describe('Orders consumer contract', () => {
  it('gets an existing order', async () => {
    const provider = new PactV3({
      consumer: 'MarketplaceFrontend',
      provider: 'MarketplaceAPI',
      dir: path.resolve(process.cwd(), 'pacts'),
      logLevel: 'warn',
    });

    provider
      .given('order 1 exists')
      .uponReceiving('a request for order 1')
      .withRequest({
        method: 'GET',
        path: '/orders/1',
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: {
          id: integer(1),
          items: like([
            {
              product_id: integer(1),
              quantity: integer(2),
            },
          ]),
          total_cents: integer(520000),
          status: like('created'),
        },
      });

    await provider.executeTest(async mockServer => {
      const response = await fetch(`${mockServer.url}/orders/1`);

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        id: number;
        items: unknown[];
        total_cents: number;
        status: string;
      };

      expect(body).toMatchObject({
        id: expect.any(Number),
        items: expect.any(Array),
        total_cents: expect.any(Number),
        status: expect.any(String),
      });
    });
  });
});
