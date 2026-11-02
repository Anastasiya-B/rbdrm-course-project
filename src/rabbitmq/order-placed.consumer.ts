import type { Channel, ConsumeMessage } from 'amqplib';

import AppDataSource from '../data-source';
import type { OrderPlacedPayload } from '../outbox/order-placed-event';
import type { OrderPlacedMessage } from './order-placed-message';
import { connectToBroker } from './broker';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_PREFETCH,
  ORDER_PLACED_QUEUE,
} from './topology';

const CONSUMER_NAME = 'order-placed-consumer';

export interface ConsumerStats {
  delivered: number;
  effect: number;
  skipped: number;
  acked: number;
}

export async function processOrderPlacedEvent(
  event: OrderPlacedMessage,
): Promise<'applied' | 'skipped'> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const queryRunner = AppDataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const markerRows = (await queryRunner.query(
      `
          INSERT INTO processed_messages (
            message_id,
            consumer
          )
          VALUES ($1, $2)
          ON CONFLICT (message_id, consumer)
          DO NOTHING
          RETURNING message_id
        `,
      [event.eventId, CONSUMER_NAME],
    )) as Array<{
      message_id: string;
    }>;

    if (markerRows.length === 0) {
      await queryRunner.commitTransaction();

      return 'skipped';
    }

    await queryRunner.query(
      `
        INSERT INTO order_event_effects (
          message_id,
          order_id,
          event_type
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id)
        DO NOTHING
      `,
      [event.eventId, event.data.orderId, event.type],
    );

    await queryRunner.commitTransaction();

    return 'applied';
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

function parseOrderPlacedEvent(message: ConsumeMessage): OrderPlacedPayload {
  const parsed = JSON.parse(
    message.content.toString('utf8'),
  ) as OrderPlacedPayload;

  if (
    !parsed.eventId ||
    parsed.type !== 'order.placed' ||
    !parsed.occurredAt ||
    !parsed.data?.orderId
  ) {
    throw new Error('Invalid order.placed event');
  }

  return parsed;
}

export async function startOrderPlacedConsumer(
  onMessage?: (
    event: OrderPlacedPayload,
    result: 'applied' | 'skipped',
  ) => Promise<void> | void,
): Promise<{
  channel: Channel;
  close: () => Promise<void>;
  stats: ConsumerStats;
}> {
  const connection = await connectToBroker();

  const channel = await connection.createChannel();

  await assertOrderPlacedTopology(channel);

  const stats: ConsumerStats = {
    delivered: 0,
    effect: 0,
    skipped: 0,
    acked: 0,
  };

  await channel.consume(
    ORDER_PLACED_QUEUE,
    async message => {
      if (!message) {
        return;
      }

      stats.delivered += 1;

      try {
        const event = parseOrderPlacedEvent(message);

        const result = await processOrderPlacedEvent(event);

        if (result === 'applied') {
          stats.effect += 1;
        } else {
          stats.skipped += 1;
        }

        if (onMessage) {
          await onMessage(event, result);
        }

        channel.ack(message);
        stats.acked += 1;
      } catch {
        channel.nack(message, false, false);
      }
    },
    {
      noAck: false,
    },
  );

  return {
    channel,
    stats,
    close: async () => {
      await channel.close();
      await connection.close();

      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    },
  };
}

export { ORDER_PLACED_PREFETCH };
