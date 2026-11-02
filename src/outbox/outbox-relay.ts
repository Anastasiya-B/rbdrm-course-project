import AppDataSource from '../data-source';
import { publishOrderPlaced } from '../rabbitmq/order-placed.publisher';
import type { OrderPlacedPayload } from './order-placed-event';

const DEFAULT_BATCH_SIZE = 10;

interface OutboxRow {
  id: string;
  event_id: string;
  type: string;
  payload: OrderPlacedPayload;
  attempts: number;
}

export interface RelayStats {
  selected: number;
  published: number;
  markedPublished: number;
}

export interface RelayOptions {
  batchSize?: number;
  crashAfterPublish?: boolean;
}

export async function relayOutboxBatch(
  options: RelayOptions = {},
): Promise<RelayStats> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const queryRunner = AppDataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  const stats: RelayStats = {
    selected: 0,
    published: 0,
    markedPublished: 0,
  };

  try {
    const rows = (await queryRunner.query(
      `
        SELECT
          id,
          event_id,
          type,
          payload,
          attempts
        FROM outbox_messages
        WHERE published_at IS NULL
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      `,
      [batchSize],
    )) as OutboxRow[];

    stats.selected = rows.length;

    for (const row of rows) {
      await queryRunner.query(
        `
          UPDATE outbox_messages
          SET attempts = attempts + 1
          WHERE id = $1
        `,
        [row.id],
      );

      await publishOrderPlaced(row.payload);

      stats.published += 1;

      if (options.crashAfterPublish) {
        throw new Error(
          'Simulated relay crash after publish before published_at update',
        );
      }

      await queryRunner.query(
        `
          UPDATE outbox_messages
          SET published_at = now()
          WHERE id = $1
        `,
        [row.id],
      );

      stats.markedPublished += 1;
    }

    await queryRunner.commitTransaction();

    return stats;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
