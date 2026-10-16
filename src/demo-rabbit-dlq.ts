import { connectToBroker } from './rabbitmq/broker';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_DLQ,
  ORDER_PLACED_QUEUE,
  ORDER_PLACED_ROUTING_KEY,
  SHOP_EVENTS_EXCHANGE,
} from './rabbitmq/topology';
import { startOrderPlacedConsumer } from './rabbitmq/order-placed.consumer';

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
}

async function waitForDlq(): Promise<void> {
  const startedAt = Date.now();

  while (true) {
    const connection = await connectToBroker();
    const channel = await connection.createChannel();

    try {
      const result = await channel.checkQueue(ORDER_PLACED_DLQ);

      if (result.messageCount >= 1) {
        return;
      }
    } finally {
      await channel.close();
      await connection.close();
    }

    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new Error('Timed out waiting for DLQ message');
    }

    await new Promise(resolve => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

async function main(): Promise<void> {
  let consumer:
    | Awaited<ReturnType<typeof startOrderPlacedConsumer>>
    | undefined;

  try {
    await prepareState();

    consumer = await startOrderPlacedConsumer();

    const connection = await connectToBroker();
    const channel = await connection.createConfirmChannel();

    try {
      channel.publish(
        SHOP_EVENTS_EXCHANGE,
        ORDER_PLACED_ROUTING_KEY,
        Buffer.from(
          JSON.stringify({
            invalid: true,
          }),
        ),
        {
          contentType: 'application/json',
          persistent: true,
          messageId: 'demo-dlq-poison',
        },
      );

      await channel.waitForConfirms();
    } finally {
      await channel.close();
      await connection.close();
    }

    await waitForDlq();

    const inspectConnection = await connectToBroker();

    const inspectChannel = await inspectConnection.createChannel();

    try {
      const workState = await inspectChannel.checkQueue(ORDER_PLACED_QUEUE);

      const dlqState = await inspectChannel.checkQueue(ORDER_PLACED_DLQ);

      const message = await inspectChannel.get(ORDER_PLACED_DLQ, {
        noAck: false,
      });

      if (!message) {
        throw new Error('DLQ message was not available');
      }

      const xDeath = message.properties.headers?.['x-death'];

      let reason: string | undefined;

      if (Array.isArray(xDeath) && xDeath.length > 0) {
        const firstDeath = xDeath[0] as {
          reason?: string;
        };

        reason = firstDeath.reason;
      }

      inspectChannel.ack(message);

      const rejected = 1;
      const work = workState.messageCount;
      const dlq = dlqState.messageCount;
      const effect = consumer.stats.effect;

      console.log(`rejected=${rejected}`);
      console.log(`work=${work}`);
      console.log(`dlq=${dlq}`);
      console.log(`dlq-reason=${reason ?? 'unknown'}`);
      console.log(`effect=${effect}`);

      const passed =
        rejected === 1 &&
        work === 0 &&
        dlq === 1 &&
        reason === 'rejected' &&
        effect === 0;

      if (!passed) {
        process.exitCode = 1;
      }
    } finally {
      await inspectChannel.close();
      await inspectConnection.close();
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (consumer) {
      await consumer.close();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
