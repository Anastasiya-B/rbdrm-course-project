import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../database.service';

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
  status: string;
  total_amount: number;
}

interface OrderItemRow {
  product_id: string;
  quantity: number;
}

export interface OrderResponse {
  id: number;
  items: Array<{
    product_id: number;
    quantity: number;
  }>;
  total_cents: number;
  status: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(input: CreateOrderInput): Promise<OrderResponse> {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    const client = await this.databaseService.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query<UserRow>(
        `
          SELECT id
          FROM users
          ORDER BY id
          LIMIT 1
        `,
      );

      const user = userResult.rows[0];

      if (!user) {
        throw new BadRequestException('No buyer available');
      }

      let totalAmount = 0;

      for (const item of input.items) {
        if (
          !Number.isInteger(item.product_id) ||
          !Number.isInteger(item.quantity) ||
          item.product_id <= 0 ||
          item.quantity <= 0
        ) {
          throw new BadRequestException('Invalid order item');
        }

        const productResult = await client.query<ProductRow>(
          `
            SELECT id, price
            FROM products
            WHERE id = $1
              AND is_active = TRUE
            LIMIT 1
          `,
          [item.product_id],
        );

        const product = productResult.rows[0];

        if (!product) {
          throw new BadRequestException(
            `Product ${item.product_id} does not exist`,
          );
        }

        totalAmount += Number(product.price) * item.quantity;
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
        [user.id, totalAmount],
      );

      const order = orderResult.rows[0];

      for (const item of input.items) {
        const productResult = await client.query<ProductRow>(
          `
            SELECT id, price
            FROM products
            WHERE id = $1
            LIMIT 1
          `,
          [item.product_id],
        );

        const product = productResult.rows[0];

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
          [order.id, item.product_id, item.quantity, Number(product.price)],
        );
      }

      await client.query('COMMIT');

      return {
        id: Number(order.id),
        items: input.items,
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

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
  }
}
