import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database.service';
import { OrderEventsService } from '../orders/order-events.service';

export interface PaymentInput {
  orderId: number;
  amount: number;
  operationKey?: string;
  providerEventId?: string;
  providerPayload?: string;
}

export type PaymentResult = 'paid' | 'duplicate';

@Injectable()
export class PaymentService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  async finalizePayment(input: PaymentInput): Promise<PaymentResult> {
    const client = await this.databaseService.connect();

    try {
      await client.query('BEGIN');
      const result = await this.finalizePaymentWithClient(client, input);
      await client.query('COMMIT');
      if (result === 'paid') {
        this.orderEventsService.emitStatusChanged(input.orderId, 'paid');
      }
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizePaymentWithClient(
    client: Pick<PoolClient, 'query'>,
    input: PaymentInput,
  ): Promise<PaymentResult> {
    const operationKey = input.operationKey ?? `order:${input.orderId}:capture`;
    const orderResult = await client.query<{
      id: string;
      status: string;
      total_amount: number;
    }>(
      `SELECT id, status, total_amount FROM orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw new NotFoundException(`Order ${input.orderId} not found`);
    }
    if (Number(order.total_amount) !== input.amount) {
      throw new ConflictException('Payment amount does not match frozen order total');
    }

    const existing = await client.query(
      `SELECT operation_key FROM payment_operations WHERE operation_key = $1 FOR UPDATE`,
      [operationKey],
    );
    if (existing.rowCount === 1) {
      return 'duplicate';
    }

    if (input.providerEventId && input.providerPayload) {
      const payloadHash = createHash('sha256')
        .update(input.providerPayload)
        .digest('hex');
      const event = await client.query(
        `
          INSERT INTO payment_provider_events (provider_event_id, operation_key, payload_hash)
          VALUES ($1, $2, $3)
          ON CONFLICT (provider_event_id) DO NOTHING
          RETURNING provider_event_id
        `,
        [input.providerEventId, operationKey, payloadHash],
      );
      if (event.rowCount === 0) {
        return 'duplicate';
      }
    }

    if (order.status === 'cancelled') {
      throw new ConflictException('Cancelled orders cannot be paid');
    }
    if (order.status !== 'created') {
      throw new ConflictException(`Order cannot be paid from status ${order.status}`);
    }

    await client.query(
      `UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'created'`,
      [input.orderId],
    );
    await client.query(
      `
        INSERT INTO payment_operations
          (operation_key, order_id, amount, provider_event_id, completed_at)
        VALUES ($1, $2, $3, $4, now())
      `,
      [operationKey, input.orderId, input.amount, input.providerEventId ?? null],
    );
    return 'paid';
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) {
      return false;
    }
    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const actual = signature.replace(/^sha256=/, '');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');
    return (
      expectedBuffer.length === actualBuffer.length &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }
}
