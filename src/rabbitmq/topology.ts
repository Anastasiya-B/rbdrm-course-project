import type { Channel } from 'amqplib';

export const SHOP_EVENTS_EXCHANGE = 'shop.events';
export const ORDER_PLACED_ROUTING_KEY = 'order.placed';
export const ORDER_PLACED_QUEUE = 'shop.order.placed';

export const SHOP_EVENTS_DLX = 'shop.events.dlx';
export const ORDER_PLACED_DLQ_ROUTING_KEY = 'order.placed.dead';
export const ORDER_PLACED_DLQ = 'shop.order.placed.dlq';

export const ORDER_PLACED_PREFETCH = 10;

export async function assertOrderPlacedTopology(
  channel: Channel,
): Promise<void> {
  await channel.assertExchange(SHOP_EVENTS_EXCHANGE, 'topic', {
    durable: true,
  });

  await channel.assertExchange(SHOP_EVENTS_DLX, 'topic', {
    durable: true,
  });

  await channel.assertQueue(ORDER_PLACED_DLQ, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
    },
  });

  await channel.bindQueue(
    ORDER_PLACED_DLQ,
    SHOP_EVENTS_DLX,
    ORDER_PLACED_DLQ_ROUTING_KEY,
  );

  await channel.assertQueue(ORDER_PLACED_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': SHOP_EVENTS_DLX,
      'x-dead-letter-routing-key': ORDER_PLACED_DLQ_ROUTING_KEY,
    },
  });

  await channel.bindQueue(
    ORDER_PLACED_QUEUE,
    SHOP_EVENTS_EXCHANGE,
    ORDER_PLACED_ROUTING_KEY,
  );

  await channel.prefetch(ORDER_PLACED_PREFETCH);
}
