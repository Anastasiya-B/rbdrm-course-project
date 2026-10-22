import AppDataSource from './data-source';
import {
  ORDER_PLACED_TYPE,
  toOrderPlacedEvent,
} from './outbox/order-placed-event';
import { relayOutboxBatch } from './outbox/outbox-relay';
import { connectToBroker } from './rabbitmq/broker';
import { startOrderPlacedConsumer } from './rabbitmq/order-placed.consumer';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_DLQ,
  ORDER_PLACED_QUEUE,
} from './rabbitmq/topology';

const EVENT_ID = 'hw22-crash-relay-event';
const WAIT_TIMEOUT_MS = 10_000;

interface OrderRow {
  id: string;
  user_id: string;
  total_amount: number;
}

interface CountRow {
  count: string;
}

interface PublishedRow {
  published_at: Date | null;
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

  throw new Error('Timed out waiting for duplicate RabbitMQ delivery');
}

async function prepareState(): Promise<OrderRow> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  await AppDataSource.query(
    `
      DELETE FROM processed_messages
      WHERE message_id = $1
    `,
    [EVENT_ID],
  );

  await AppDataSource.query(
    `
      DELETE FROM order_event_effects
      WHERE message_id = $1
    `,
    [EVENT_ID],
  );

  await AppDataSource.query(
    `
      DELETE FROM outbox_messages
      WHERE event_id = $1
    `,
    [EVENT_ID],
  );

  // Keep the demo deterministic: relay must see only this demo event.
  await AppDataSource.query(`
    DELETE FROM outbox_messages
    WHERE published_at IS NULL
  `);

  const orders = (await AppDataSource.query(
    `
      SELECT
        id,
        user_id,
        total_amount
      FROM orders
      ORDER BY id
      LIMIT 1
    `,
  )) as OrderRow[];

  const order = orders[0];

  if (!order) {
    throw new Error('No order found. Run npm run seed first.');
  }

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

  return order;
}

async function createOutboxEvent(order: OrderRow): Promise<void> {
  const event = toOrderPlacedEvent({
    eventId: EVENT_ID,
    orderId: Number(order.id),
    userId: Number(order.user_id),
    items: [],
    totalAmount: Number(order.total_amount),
  });

  if (event.type !== ORDER_PLACED_TYPE) {
    throw new Error('Unexpected event type');
  }

  await AppDataSource.query(
    `
      INSERT INTO outbox_messages (
        event_id,
        aggregate_type,
        aggregate_id,
        type,
        payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      event.eventId,
      'order',
      String(order.id),
      event.type,
      JSON.stringify(event),
    ],
  );
}

async function main(): Promise<void> {
  let consumer:
    | Awaited<ReturnType<typeof startOrderPlacedConsumer>>
    | undefined;

  let published = 0;

  try {
    const order = await prepareState();

    await createOutboxEvent(order);

    consumer = await startOrderPlacedConsumer();

    /*
     * First relay attempt:
     *
     * SELECT outbox
     * -> publish succeeds
     * -> simulated crash BEFORE UPDATE published_at
     * -> DB transaction rolls back
     *
     * RabbitMQ cannot roll back the already-published message.
     */
    try {
      await relayOutboxBatch({
        batchSize: 1,
        crashAfterPublish: true,
      });

      throw new Error('Expected first relay attempt to crash');
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('Simulated relay crash after publish')
      ) {
        throw error;
      }

      // The simulated exception is thrown only after
      // publisher confirms, so one publish already happened.
      published += 1;
    }

    const afterCrash = (await AppDataSource.query(
      `
        SELECT published_at
        FROM outbox_messages
        WHERE event_id = $1
      `,
      [EVENT_ID],
    )) as PublishedRow[];

    if (afterCrash[0]?.published_at !== null) {
      throw new Error(
        'Outbox was incorrectly marked as published after relay crash',
      );
    }

    /*
     * Second relay attempt:
     *
     * published_at is still NULL,
     * therefore the same event is selected and published again.
     */
    const secondAttempt = await relayOutboxBatch({
      batchSize: 1,
    });

    published += secondAttempt.published;

    await waitFor(async () => {
      if (!consumer) {
        return false;
      }

      const effect = await getCount(
        `
          SELECT count(*)::text AS count
          FROM order_event_effects
          WHERE message_id = $1
        `,
        [EVENT_ID],
      );

      const processed = await getCount(
        `
          SELECT count(*)::text AS count
          FROM processed_messages
          WHERE message_id = $1
        `,
        [EVENT_ID],
      );

      return consumer.stats.delivered >= 2 && effect === 1 && processed === 1;
    });

    const deliveries = consumer.stats.delivered;

    const applied = consumer.stats.effect;

    const effect = await getCount(
      `
        SELECT count(*)::text AS count
        FROM order_event_effects
        WHERE message_id = $1
      `,
      [EVENT_ID],
    );

    const processed = await getCount(
      `
        SELECT count(*)::text AS count
        FROM processed_messages
        WHERE message_id = $1
      `,
      [EVENT_ID],
    );

    const finalOutbox = (await AppDataSource.query(
      `
        SELECT published_at
        FROM outbox_messages
        WHERE event_id = $1
      `,
      [EVENT_ID],
    )) as PublishedRow[];

    const markedPublished = finalOutbox[0]?.published_at != null;

    console.log(`published=${published}`);
    console.log(`deliveries=${deliveries}`);
    console.log(`applied=${applied}`);
    console.log(`effect=${effect}`);
    console.log(`processed=${processed}`);

    const passed =
      published >= 2 &&
      deliveries >= 2 &&
      applied === 1 &&
      effect === 1 &&
      processed === 1 &&
      markedPublished;

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

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
