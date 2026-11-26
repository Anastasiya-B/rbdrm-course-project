import { ConflictException } from '@nestjs/common';
import { jest } from '@jest/globals';

import { PaymentService } from '../../src/payments/payment.service';

describe('PaymentService business rules', () => {
  it('deduplicates a repeated payment operation without applying it twice', async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT id, status, total_amount')) {
          return { rows: [{ id: '42', status: 'created', total_amount: 1299 }], rowCount: 1 };
        }
        if (sql.includes('SELECT operation_key')) {
          return { rows: [{ operation_key: 'order:42:capture' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const service = new PaymentService(
      {} as never,
      { emitStatusChanged: jest.fn() } as never,
    );

    const result = await service.finalizePaymentWithClient(client as never, {
      orderId: 42,
      amount: 1299,
    });

    expect(result).toBe('duplicate');
    expect(queries.some(sql => sql.includes("UPDATE orders SET status = 'paid'"))).toBe(false);
    expect(queries.some(sql => sql.includes('INSERT INTO payment_operations'))).toBe(false);
  });

  it('rejects payment when the frozen order amount differs', async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT id, status, total_amount')) {
          return { rows: [{ id: '42', status: 'created', total_amount: 1299 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const service = new PaymentService({} as never, {} as never);

    await expect(service.finalizePaymentWithClient(client as never, { orderId: 42, amount: 1300 }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
