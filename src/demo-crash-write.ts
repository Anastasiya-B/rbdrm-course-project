import AppDataSource from './data-source';
import { toOrderPlacedEvent } from './outbox/order-placed-event';
import { connectToBroker } from './rabbitmq/broker';
import { startOrderPlacedConsumer } from './rabbitmq/order-placed.consumer';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_DLQ,
  ORDER_PLACED_QUEUE,
} from './rabbitmq/topology';

const EVENT_ID = 'hw22-crash-write-event';
const WAIT_AFTER_ROLLBACK_MS = 250;

interface UserRow {
  id: string;
}

interface ProductRow {
  id: string;
  price: number;
}

interface OrderRow {
  id: string;
}

interface CountRow {
  count: string;
}

async function getCount(sql: string, params: unknown[] = []): Promise<number> {
  const rows = (await AppDataSource.query(sql, params)) as CountRow[];

  return Number(rows[0]?.count ?? 0);
}

async function prepareState(): Promise<void> {
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

async function simulateFailedWrite(): Promise<{
  writeFailed: number;
  attemptedOrderId: string | null;
}> {
  const queryRunner = AppDataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  let attemptedOrderId: string | null = null;

  try {
    const users = (await queryRunner.query(
      `
        SELECT id
        FROM users
        ORDER BY id
        LIMIT 1
      `,
    )) as UserRow[];

    const user = users[0];

    if (!user) {
      throw new Error('No user found. Run npm run seed first.');
    }

    const products = (await queryRunner.query(
      `
        SELECT id, price
        FROM products
        WHERE is_active = TRUE
        ORDER BY id
        LIMIT 1
      `,
    )) as ProductRow[];

    const product = products[0];

    if (!product) {
      throw new Error('No active product found. Run npm run seed first.');
    }

    const orders = (await queryRunner.query(
      `
        INSERT INTO orders (
          user_id,
          status,
          total_amount
        )
        VALUES ($1, 'created', $2)
        RETURNING id
      `,
      [user.id, Number(product.price)],
    )) as OrderRow[];

    const order = orders[0];

    if (!order) {
      throw new Error('Failed to create demo order');
    }

    attemptedOrderId = order.id;

    await queryRunner.query(
      `
        INSERT INTO order_items (
          order_id,
          product_id,
          quantity,
          unit_price
        )
        VALUES ($1, $2, 1, $3)
      `,
      [order.id, product.id, Number(product.price)],
    );

    const event = toOrderPlacedEvent({
      eventId: EVENT_ID,
      orderId: Number(order.id),
      userId: Number(user.id),
      items: [
        {
          product_id: Number(product.id),
          quantity: 1,
        },
      ],
      totalAmount: Number(product.price),
    });

    await queryRunner.query(
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

    // Intentional failure AFTER the business row and outbox row exist
    // inside the transaction, but BEFORE COMMIT.
    throw new Error(
      'Simulated business transaction failure after outbox insert',
    );
  } catch {
    await queryRunner.rollbackTransaction();

    return {
      writeFailed: 1,
      attemptedOrderId,
    };
  } finally {
    await queryRunner.release();
  }
}

async function main(): Promise<void> {
  let consumer:
    | Awaited<ReturnType<typeof startOrderPlacedConsumer>>
    | undefined;

  try {
    await prepareState();

    consumer = await startOrderPlacedConsumer();

    const result = await simulateFailedWrite();

    await new Promise(resolve => setTimeout(resolve, WAIT_AFTER_ROLLBACK_MS));

    const orders =
      result.attemptedOrderId === null
        ? 0
        : await getCount(
            `
              SELECT count(*)::text AS count
              FROM orders
              WHERE id = $1
            `,
            [result.attemptedOrderId],
          );

    const outbox = await getCount(
      `
        SELECT count(*)::text AS count
        FROM outbox_messages
        WHERE event_id = $1
      `,
      [EVENT_ID],
    );

    const effect = await getCount(
      `
        SELECT count(*)::text AS count
        FROM order_event_effects
        WHERE message_id = $1
      `,
      [EVENT_ID],
    );

    const deliveries = consumer.stats.delivered;

    const published = 0;

    console.log(`write-failed=${result.writeFailed}`);
    console.log(`orders=${orders}`);
    console.log(`outbox=${outbox}`);
    console.log(`published=${published}`);
    console.log(`deliveries=${deliveries}`);
    console.log(`effect=${effect}`);

    const passed =
      result.writeFailed === 1 &&
      orders === 0 &&
      outbox === 0 &&
      published === 0 &&
      deliveries === 0 &&
      effect === 0;

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
