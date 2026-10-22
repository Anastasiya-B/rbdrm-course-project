import type { PoolClient } from 'pg';

import type { OrderPlacedPayload } from './order-placed-event';

export async function insertOrderPlacedOutbox(
  client: PoolClient,
  event: OrderPlacedPayload,
): Promise<void> {
  await client.query(
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
      String(event.data.orderId),
      event.type,
      JSON.stringify(event),
    ],
  );
}
