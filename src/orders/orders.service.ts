import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database.service';
import {
  ORDER_STATUSES,
  type OrderStatus,
} from '../entities/order.entity';
import type { UserRole } from '../auth/auth.tokens';
import { insertOrderPlacedOutbox } from '../outbox/outbox.repository';
import { toOrderPlacedEvent } from '../outbox/order-placed-event';
import { OrderEventsService } from './order-events.service';

interface CreateOrderItemInput {
  product_id: number;
  quantity: number;
}

interface CreateOrderInput {
  items: CreateOrderItemInput[];
}

interface ProductRow {
  id: string;
  price: number;
}

interface UserRow {
  id: string;
}

interface OrderRow {
  id: string;
  status: OrderStatus;
  total_amount: number;
}

interface OrderItemRow {
  product_id: string;
  quantity: number;
}

interface IdempotencyRow {
  order_id: string | null;
  request_fingerprint: string | null;
}

const MAX_ITEM_QUANTITY = 1_000_000;

export interface OrderResponse {
  id: number;
  items: Array<{
    product_id: number;
    quantity: number;
  }>;
  total_cents: number;
  status: OrderStatus;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  async create(
    input: CreateOrderInput,
    idempotencyKey: string,
    userId: number,
  ): Promise<OrderResponse> {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    if (!idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency-Key must not be empty');
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException('Authenticated user is required');
    }

    const normalizedItems = input.items.map(item => ({
      product_id: item.product_id,
      quantity: item.quantity,
    }));
    const seenProductIds = new Set<number>();

    for (const item of normalizedItems) {
      if (
        !Number.isInteger(item.product_id) ||
        !Number.isInteger(item.quantity) ||
        item.product_id <= 0 ||
        item.quantity <= 0 ||
        item.quantity > MAX_ITEM_QUANTITY
      ) {
        throw new BadRequestException('Invalid order item');
      }

      if (seenProductIds.has(item.product_id)) {
        throw new BadRequestException('Duplicate product ids are not allowed');
      }

      seenProductIds.add(item.product_id);
    }

    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ items: normalizedItems }))
      .digest('hex');

    const client = await this.databaseService.connect();

    try {
      await client.query('BEGIN');

      const reservationResult = await client.query(
        `
          INSERT INTO idempotency_keys (
            idempotency_key,
            user_id,
            operation,
            request_fingerprint
          )
          VALUES ($1, $2, 'create_order', $3)
          ON CONFLICT (idempotency_key, user_id, operation)
          WHERE user_id IS NOT NULL
          DO NOTHING
          RETURNING idempotency_key
        `,
        [idempotencyKey, userId, requestFingerprint],
      );

      const reserved = reservationResult.rowCount === 1;

      if (!reserved) {
        const existingResult = await client.query<IdempotencyRow>(
          `
            SELECT order_id, request_fingerprint
            FROM idempotency_keys
            WHERE idempotency_key = $1
              AND user_id = $2
              AND operation = 'create_order'
            FOR UPDATE
          `,
          [idempotencyKey, userId],
        );

        const existing = existingResult.rows[0];

        if (!existing?.order_id) {
          throw new Error('Idempotency key exists without completed order');
        }

        if (existing.request_fingerprint !== requestFingerprint) {
          throw new ConflictException(
            'Idempotency-Key was already used with a different request body',
          );
        }

        const response = await this.findByIdWithClient(
          client,
          Number(existing.order_id),
        );

        await client.query('COMMIT');

        return response;
      }

      const userResult = await client.query<UserRow>(
        `
          SELECT id
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [userId],
      );

      const user = userResult.rows[0];

      if (!user) {
        throw new BadRequestException('No buyer available');
      }

      let totalAmount = 0n;

      const reservedProducts = new Map<number, ProductRow>();
      for (const item of [...normalizedItems].sort((a, b) => a.product_id - b.product_id)) {
        const productResult = await client.query<ProductRow>(
          `
            UPDATE products
            SET stock_quantity = stock_quantity - $2
            WHERE id = $1
              AND is_active = TRUE
              AND stock_quantity >= $2
            RETURNING id, price
          `,
          [item.product_id, item.quantity],
        );

        const product = productResult.rows[0];

        if (!product) {
          const existence = await client.query<{ id: string }>(
            'SELECT id FROM products WHERE id = $1 AND is_active = TRUE LIMIT 1',
            [item.product_id],
          );

          if (existence.rowCount === 0) {
            throw new BadRequestException(
              `Product ${item.product_id} does not exist`,
            );
          }

          throw new ConflictException(
            `Insufficient stock for product ${item.product_id}`,
          );
        }

        reservedProducts.set(item.product_id, product);
        const unitPrice = Number(product.price);
        if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) {
          throw new BadRequestException('Product price is outside safe bounds');
        }

        totalAmount += BigInt(unitPrice) * BigInt(item.quantity);

        if (totalAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new BadRequestException('Order total is outside safe bounds');
        }
      }

      const orderResult = await client.query<OrderRow>(
        `
          INSERT INTO orders (
            user_id,
            status,
            total_amount
          )
          VALUES ($1, 'created', $2)
          RETURNING id, status, total_amount
        `,
        [user.id, Number(totalAmount)],
      );

      const order = orderResult.rows[0];

      if (!order) {
        throw new Error('Failed to create order');
      }

      for (const item of normalizedItems) {
        const product = reservedProducts.get(item.product_id);
        await client.query(
          `
            INSERT INTO order_items (
              order_id,
              product_id,
              quantity,
              unit_price
            )
            VALUES ($1, $2, $3, $4)
          `,
          [order.id, item.product_id, item.quantity, Number(product?.price)],
        );
      }

      const event = toOrderPlacedEvent({
        eventId: `order.placed:${order.id}`,
        orderId: Number(order.id),
        userId: Number(user.id),
        items: normalizedItems,
        totalAmount: Number(order.total_amount),
      });

      await insertOrderPlacedOutbox(client, event);

      await client.query(
        `
          UPDATE idempotency_keys
          SET order_id = $2
          WHERE idempotency_key = $1
            AND user_id = $3
            AND operation = 'create_order'
        `,
        [idempotencyKey, order.id, userId],
      );

      await client.query('COMMIT');

      return {
        id: Number(order.id),
        items: normalizedItems,
        total_cents: Number(order.total_amount),
        status: order.status,
      };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: number): Promise<OrderResponse> {
    const orderResult = await this.databaseService.query<OrderRow>(
      `
          SELECT id, status, total_amount
          FROM orders
          WHERE id = $1
          LIMIT 1
        `,
      [id],
    );

    const order = orderResult.rows[0];

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    const itemsResult = await this.databaseService.query<OrderItemRow>(
      `
          SELECT product_id, quantity
          FROM order_items
          WHERE order_id = $1
          ORDER BY id
        `,
      [id],
    );

    return {
      id: Number(order.id),
      items: itemsResult.rows.map(item => ({
        product_id: Number(item.product_id),
        quantity: item.quantity,
      })),
      total_cents: Number(order.total_amount),
      status: order.status,
    };
  }

  async updateStatus(
    id: number,
    status: string,
    userId: number,
    role: UserRole,
  ): Promise<OrderResponse> {
    if (!this.isOrderStatus(status)) {
      throw new BadRequestException(`Invalid order status: ${status}`);
    }

    const client = await this.databaseService.connect();

    try {
      await client.query('BEGIN');

      const currentResult = await client.query<{ status: OrderStatus }>(
        'SELECT status FROM orders WHERE id = $1 FOR UPDATE',
        [id],
      );
      const current = currentResult.rows[0];

      if (!current) {
        throw new NotFoundException(`Order ${id} not found`);
      }

      if (role === 'seller') {
        const ownership = await client.query(
          `
            SELECT 1
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
              AND p.owner_id = $2
            LIMIT 1
          `,
          [id, userId],
        );

        if (ownership.rowCount !== 1) {
          throw new ForbiddenException('Seller does not own this order');
        }
      }

      if (current.status !== 'created' || status !== 'cancelled') {
        throw new ConflictException(
          `Invalid order status transition: ${current.status} -> ${status}`,
        );
      }

      const result = await client.query<OrderRow>(
        `
          UPDATE orders
          SET status = $2
          WHERE id = $1
            AND status = 'created'
          RETURNING id, status, total_amount
        `,
        [id, status],
      );
      const order = result.rows[0];

      if (!order) {
        throw new ConflictException('Order status changed concurrently');
      }

      await client.query(
        `
          UPDATE products p
          SET stock_quantity = p.stock_quantity + oi.quantity
          FROM order_items oi
          WHERE oi.order_id = $1
            AND p.id = oi.product_id
        `,
        [id],
      );

      await client.query('COMMIT');
      this.orderEventsService.emitStatusChanged(Number(order.id), order.status);

      return this.findById(id);
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async belongsToUser(orderId: number, userId: number): Promise<boolean> {
    const result = await this.databaseService.query(
      `
          SELECT 1
          FROM orders
          WHERE id = $1
            AND user_id = $2
          LIMIT 1
        `,
      [orderId, userId],
    );

    return result.rowCount === 1;
  }

  private async findByIdWithClient(
    client: PoolClient,
    id: number,
  ): Promise<OrderResponse> {
    const orderResult = await client.query<OrderRow>(
      `
        SELECT id, status, total_amount
        FROM orders
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    const order = orderResult.rows[0];

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    const itemsResult = await client.query<OrderItemRow>(
      `
          SELECT product_id, quantity
          FROM order_items
          WHERE order_id = $1
          ORDER BY id
        `,
      [id],
    );

    return {
      id: Number(order.id),
      items: itemsResult.rows.map(item => ({
        product_id: Number(item.product_id),
        quantity: item.quantity,
      })),
      total_cents: Number(order.total_amount),
      status: order.status,
    };
  }

  private isOrderStatus(value: string): value is OrderStatus {
    return (ORDER_STATUSES as readonly string[]).includes(value);
  }

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve original transaction error.
    }
  }
}
