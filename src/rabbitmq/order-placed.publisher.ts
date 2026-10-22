import { connectToBroker } from './broker';
import type { OrderPlacedEvent } from './order-placed.event';
import { ORDER_PLACED_ROUTING_KEY, SHOP_EVENTS_EXCHANGE } from './topology';

export async function publishOrderPlaced(
  event: OrderPlacedEvent,
): Promise<void> {
  const connection = await connectToBroker();

  const channel = await connection.createConfirmChannel();

  try {
    const published = channel.publish(
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

    if (!published) {
      await new Promise<void>(resolve => {
        channel.once('drain', resolve);
      });
    }

    await channel.waitForConfirms();
  } finally {
    await channel.close();
    await connection.close();
  }
}
