import { Injectable } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { DatabaseService } from '../database.service';
import { createLogger } from './logger';

interface OrderRow {
  id: string;
  status: string;
  total_amount: number;
}

export interface ObservabilityOrder {
  id: number;
  status: string;
  total_cents: number;
}

@Injectable()
export class ObservabilityOrdersRepository {
  private readonly logger = createLogger('orders.repo');

  constructor(private readonly database: DatabaseService) {}

  async findById(id: number): Promise<ObservabilityOrder | null> {
    const tracer = trace.getTracer('marketplace-api');

    return tracer.startActiveSpan('orders.repo.findById', async span => {
      try {
        this.logger.info(
          {
            orderId: id,
          },
          'repository lookup',
        );

        const result = await this.database.query<OrderRow>(
          `
                  SELECT
                    id,
                    status,
                    total_amount
                  FROM orders
                  WHERE id = $1
                  LIMIT 1
                `,
          [id],
        );

        const row = result.rows[0];

        if (!row) {
          return null;
        }

        return {
          id: Number(row.id),

          status: row.status,

          total_cents: Number(row.total_amount),
        };
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
        });

        if (error instanceof Error) {
          span.recordException(error);
        }

        throw error;
      } finally {
        span.end();
      }
    });
  }
}
