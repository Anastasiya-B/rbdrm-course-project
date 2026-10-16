import { randomUUID } from 'node:crypto';

import AppDataSource from './data-source';
import { connectToBroker } from './rabbitmq/broker';
import {
  ORDER_PLACED_EVENT_TYPE,
  OrderPlacedEvent,
} from './rabbitmq/order-placed.event';
import { publishOrderPlaced } from './rabbitmq/order-placed.publisher';
import { startOrderPlacedConsumer } from './rabbitmq/order-placed.consumer';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_DLQ,
  ORDER_PLACED_PREFETCH,
  ORDER_PLACED_QUEUE,
} from './rabbitmq/topology';

const EVENT_COUNT = 5;
const WAIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 50;

async function prepareState(): Promise<void> {
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

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  await AppDataSource.query(`
    DELETE FROM processed_order_events
    WHERE event_type = 'order.placed'
  `);
}

function createEvent(index: number): OrderPlacedEvent {
  return {
    eventId: `demo-publish-${randomUUID()}`,
    type: ORDER_PLACED_EVENT_TYPE,
    occurredAt: new Date().toISOString(),
    data: {
      orderId: String(index + 1),
      userId: String(index + 1),
      productId: String(index + 1),
      quantity: 1,
      totalAmount: 1000 + index,
    },
  };
}

async function waitForEffects(getEffectCount: () => number): Promise<void> {
  const startedAt = Date.now();

  while (getEffectCount() < EVENT_COUNT) {
    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${EVENT_COUNT} effects`);
    }

    await new Promise(resolve => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

async function getQueueDepth(queue: string): Promise<number> {
  const connection = await connectToBroker();
  const channel = await connection.createChannel();

  try {
    const result = await channel.checkQueue(queue);
    return result.messageCount;
  } finally {
    await channel.close();
    await connection.close();
  }
}

async function main(): Promise<void> {
  let consumer:
    | Awaited<ReturnType<typeof startOrderPlacedConsumer>>
    | undefined;

  try {
    await prepareState();

    consumer = await startOrderPlacedConsumer();

    let published = 0;

    for (let index = 0; index < EVENT_COUNT; index += 1) {
      const event = createEvent(index);

      await publishOrderPlaced(event);
      published += 1;
    }

    await waitForEffects(() => consumer?.stats.effect ?? 0);

    const work = await getQueueDepth(ORDER_PLACED_QUEUE);

    const dlq = await getQueueDepth(ORDER_PLACED_DLQ);

    const delivered = consumer.stats.delivered;

    const effect = consumer.stats.effect;

    const acked = consumer.stats.acked;

    console.log(`published=${published}`);
    console.log(`delivered=${delivered}`);
    console.log(`effect=${effect}`);
    console.log(`acked=${acked}`);
    console.log(`dlq=${dlq}`);
    console.log(`prefetch=${ORDER_PLACED_PREFETCH}`);

    const passed =
      published === EVENT_COUNT &&
      delivered === EVENT_COUNT &&
      effect === EVENT_COUNT &&
      acked === EVENT_COUNT &&
      work === 0 &&
      dlq === 0 &&
      ORDER_PLACED_PREFETCH >= 1 &&
      ORDER_PLACED_PREFETCH <= 2000;

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (consumer) {
      await consumer.close();
    } else if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
