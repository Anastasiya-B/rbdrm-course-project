import type { Channel, ConsumeMessage } from 'amqplib';

import AppDataSource from '../data-source';
import { connectToBroker } from './broker';
import type { OrderPlacedEvent } from './order-placed.event';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_PREFETCH,
  ORDER_PLACED_QUEUE,
} from './topology';

export interface ConsumerStats {
  delivered: number;
  effect: number;
  skipped: number;
  acked: number;
}

interface ProcessedEventRow {
  event_id: string;
}

export async function processOrderPlacedEvent(
  event: OrderPlacedEvent,
): Promise<'applied' | 'skipped'> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const rows = (await AppDataSource.query(
    `
        INSERT INTO processed_order_events (
          event_id,
          order_id,
          event_type
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (event_id)
        DO NOTHING
        RETURNING event_id
      `,
    [event.eventId, event.data.orderId, event.type],
  )) as ProcessedEventRow[];

  return rows.length === 1 ? 'applied' : 'skipped';
}

function parseOrderPlacedEvent(message: ConsumeMessage): OrderPlacedEvent {
  const parsed = JSON.parse(
    message.content.toString('utf8'),
  ) as OrderPlacedEvent;

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
    event: OrderPlacedEvent,
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
