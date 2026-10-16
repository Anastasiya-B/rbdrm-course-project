import type { ConsumeMessage } from 'amqplib';

import AppDataSource from './data-source';
import { connectToBroker } from './rabbitmq/broker';
import {
  ORDER_PLACED_EVENT_TYPE,
  OrderPlacedEvent,
} from './rabbitmq/order-placed.event';
import { processOrderPlacedEvent } from './rabbitmq/order-placed.consumer';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_DLQ,
  ORDER_PLACED_QUEUE,
  ORDER_PLACED_ROUTING_KEY,
  SHOP_EVENTS_EXCHANGE,
} from './rabbitmq/topology';

const EVENT_ID = 'demo-duplicate-event';
const WAIT_TIMEOUT_MS = 10_000;

function createEvent(): OrderPlacedEvent {
  return {
    eventId: EVENT_ID,
    type: ORDER_PLACED_EVENT_TYPE,
    occurredAt: new Date().toISOString(),
    data: {
      orderId: '1',
      userId: '1',
      productId: '1',
      quantity: 1,
      totalAmount: 1000,
    },
  };
}

function parseEvent(message: ConsumeMessage): OrderPlacedEvent {
  return JSON.parse(message.content.toString('utf8')) as OrderPlacedEvent;
}

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

  await AppDataSource.query(
    `
      DELETE FROM processed_order_events
      WHERE event_id = $1
    `,
    [EVENT_ID],
  );
}

async function publishEvent(): Promise<void> {
  const connection = await connectToBroker();
  const channel = await connection.createConfirmChannel();

  try {
    const event = createEvent();

    channel.publish(
      SHOP_EVENTS_EXCHANGE,
      ORDER_PLACED_ROUTING_KEY,
      Buffer.from(JSON.stringify(event)),
      {
        contentType: 'application/json',
        persistent: true,
        messageId: event.eventId,
        type: event.type,
      },
    );

    await channel.waitForConfirms();
  } finally {
    await channel.close();
    await connection.close();
  }
}

async function main(): Promise<void> {
  let deliveries = 0;
  let effect = 0;
  let skipped = 0;

  const connection = await connectToBroker();
  const channel = await connection.createChannel();

  try {
    await prepareState();
    await assertOrderPlacedTopology(channel);

    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for duplicate delivery'));
      }, WAIT_TIMEOUT_MS);

      channel
        .consume(
          ORDER_PLACED_QUEUE,
          async message => {
            if (!message) {
              return;
            }

            deliveries += 1;

            try {
              const event = parseEvent(message);

              const result = await processOrderPlacedEvent(event);

              if (result === 'applied') {
                effect += 1;
              } else {
                skipped += 1;
              }

              if (deliveries === 1) {
                channel.nack(message, false, true);
                return;
              }

              channel.ack(message);

              clearTimeout(timeout);
              resolve();
            } catch (error) {
              clearTimeout(timeout);
              reject(error);
            }
          },
          {
            noAck: false,
          },
        )
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });

    await publishEvent();
    await completed;

    console.log(`deliveries=${deliveries}`);
    console.log(`effect=${effect}`);
    console.log(`skipped=${skipped}`);

    const passed = deliveries >= 2 && effect === 1 && skipped >= 1;

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await channel.close();
    await connection.close();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
