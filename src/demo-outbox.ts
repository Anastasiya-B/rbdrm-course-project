import { NestFactory } from '@nestjs/core';
import request from 'supertest';

import { AppModule } from './app.module';
import AppDataSource from './data-source';
import { relayOutboxBatch } from './outbox/outbox-relay';
import { connectToBroker } from './rabbitmq/broker';
import { startOrderPlacedConsumer } from './rabbitmq/order-placed.consumer';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_DLQ,
  ORDER_PLACED_QUEUE,
} from './rabbitmq/topology';

const IDEMPOTENCY_KEY = 'hw22-demo-outbox';
const WAIT_TIMEOUT_MS = 10_000;

interface IdRow {
  id: string;
}

interface CountRow {
  count: string;
}

async function prepareState(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const previous = (await AppDataSource.query(
    `
      SELECT order_id
      FROM idempotency_keys
      WHERE idempotency_key = $1
    `,
    [IDEMPOTENCY_KEY],
  )) as Array<{ order_id: string | null }>;

  const previousOrderId = previous[0]?.order_id;

  if (previousOrderId) {
    const eventId = `order.placed:${previousOrderId}`;

    await AppDataSource.query(
      `
        DELETE FROM processed_messages
        WHERE message_id = $1
      `,
      [eventId],
    );

    await AppDataSource.query(
      `
        DELETE FROM order_event_effects
        WHERE message_id = $1
      `,
      [eventId],
    );

    await AppDataSource.query(
      `
        DELETE FROM outbox_messages
        WHERE aggregate_type = 'order'
          AND aggregate_id = $1
      `,
      [String(previousOrderId)],
    );
  }

  await AppDataSource.query(
    `
      DELETE FROM idempotency_keys
      WHERE idempotency_key = $1
    `,
    [IDEMPOTENCY_KEY],
  );

  if (previousOrderId) {
    await AppDataSource.query(
      `
        DELETE FROM orders
        WHERE id = $1
      `,
      [previousOrderId],
    );
  }

  // Demo must start without stale pending outbox messages.
  await AppDataSource.query(`
    DELETE FROM outbox_messages
    WHERE published_at IS NULL
  `);

  const connection = await connectToBroker();
  const channel = await connection.createChannel();

  try {
    await assertOrderPlacedTopology(channel);
    await channel.purgeQueue(ORDER_PLACED_QUEUE);
    await channel.purgeQueue(ORDER_PLACED_DLQ);
  } finally {
    await channel.close();
    await connection.close();
  }
}

async function getProductId(): Promise<number> {
  const rows = (await AppDataSource.query(
    `
      SELECT id
      FROM products
      WHERE is_active = TRUE
      ORDER BY id
      LIMIT 1
    `,
  )) as IdRow[];

  const product = rows[0];

  if (!product) {
    throw new Error('No active product found. Run npm run seed first.');
  }

  return Number(product.id);
}

async function getCount(sql: string, params: unknown[] = []): Promise<number> {
  const rows = (await AppDataSource.query(sql, params)) as CountRow[];

  return Number(rows[0]?.count ?? 0);
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    if (await predicate()) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for RabbitMQ consumer');
}

async function main(): Promise<void> {
  let consumer:
    | Awaited<ReturnType<typeof startOrderPlacedConsumer>>
    | undefined;

  const app = await NestFactory.create(AppModule, {
    logger: false,
  });

  try {
    await prepareState();

    const productId = await getProductId();

    await app.init();

    const server = app.getHttpServer();

    let requests = 0;

    const body = {
      items: [
        {
          product_id: productId,
          quantity: 1,
        },
      ],
    };

    const firstResponse = await request(server)
      .post('/orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(body)
      .expect(201);

    requests += 1;

    const secondResponse = await request(server)
      .post('/orders')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(body)
      .expect(201);

    requests += 1;

    if (firstResponse.body.id !== secondResponse.body.id) {
      throw new Error('Idempotency invariant failed: order ids differ');
    }

    const orderId = Number(firstResponse.body.id);

    const orders = await getCount(
      `
        SELECT count(*)::text AS count
        FROM orders
        WHERE id = $1
      `,
      [orderId],
    );

    const outbox = await getCount(
      `
        SELECT count(*)::text AS count
        FROM outbox_messages
        WHERE aggregate_type = 'order'
          AND aggregate_id = $1
      `,
      [String(orderId)],
    );

    consumer = await startOrderPlacedConsumer();

    const relay = await relayOutboxBatch({
      batchSize: 10,
    });

    await waitFor(async () => {
      const count = await getCount(
        `
          SELECT count(*)::text AS count
          FROM processed_messages
          WHERE message_id = $1
        `,
        [`order.placed:${orderId}`],
      );

      return count === 1;
    });

    const processed = await getCount(
      `
        SELECT count(*)::text AS count
        FROM processed_messages
        WHERE message_id = $1
      `,
      [`order.placed:${orderId}`],
    );

    const effect = await getCount(
      `
        SELECT count(*)::text AS count
        FROM order_event_effects
        WHERE message_id = $1
      `,
      [`order.placed:${orderId}`],
    );

    const published = relay.published;

    const deliveries = consumer.stats.delivered;

    console.log(`requests=${requests}`);
    console.log(`orders=${orders}`);
    console.log(`outbox=${outbox}`);
    console.log(`published=${published}`);
    console.log(`deliveries=${deliveries}`);
    console.log(`effect=${effect}`);
    console.log(`processed=${processed}`);

    const passed =
      requests === 2 &&
      orders === 1 &&
      outbox === 1 &&
      published === 1 &&
      deliveries === 1 &&
      effect === 1 &&
      processed === 1;

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (consumer) {
      await consumer.close();
    }

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
