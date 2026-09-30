import { QueryResult, QueryRunner } from 'typeorm';

import AppDataSource from './data-source';

export interface CheckoutInput {
  userId: string;
  productId: string;
  quantity: number;
}

export interface CheckoutResult {
  orderId: string;
  totalAmount: number;
  remainingStock: number;
}

interface ProductUpdateRow {
  id: string;
  price: number;
  stock_quantity: number;
}

interface UserUpdateRow {
  id: string;
  balance: number;
}

interface OrderInsertRow {
  id: string;
}

export class CheckoutError extends Error {
  constructor(
    public readonly code: 'INSUFFICIENT_STOCK' | 'INSUFFICIENT_BALANCE',
  ) {
    super(code);
    this.name = 'CheckoutError';
  }
}

async function executeCheckout(
  queryRunner: QueryRunner,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const productResult = (await queryRunner.query(
    `
      UPDATE products
      SET stock_quantity = stock_quantity - $1
      WHERE id = $2
        AND stock_quantity >= $1
      RETURNING id, price, stock_quantity
    `,
    [input.quantity, input.productId],
    true,
  )) as QueryResult;

  const product = productResult.records[0] as ProductUpdateRow | undefined;

  if (!product) {
    throw new CheckoutError('INSUFFICIENT_STOCK');
  }

  const totalAmount = Number(product.price) * input.quantity;

  const userResult = (await queryRunner.query(
    `
      UPDATE users
      SET balance = balance - $1
      WHERE id = $2
        AND balance >= $1
      RETURNING id, balance
    `,
    [totalAmount, input.userId],
    true,
  )) as QueryResult;

  const user = userResult.records[0] as UserUpdateRow | undefined;

  if (!user) {
    throw new CheckoutError('INSUFFICIENT_BALANCE');
  }

  const orderResult = (await queryRunner.query(
    `
      INSERT INTO orders (
        user_id,
        status,
        total_amount
      )
      VALUES ($1, 'created', $2)
      RETURNING id
    `,
    [input.userId, totalAmount],
    true,
  )) as QueryResult;

  const order = orderResult.records[0] as OrderInsertRow | undefined;

  if (!order) {
    throw new Error('Failed to create order');
  }

  await queryRunner.query(
    `
      INSERT INTO order_items (
        order_id,
        product_id,
        quantity,
        unit_price
      )
      VALUES ($1, $2, $3, $4)
    `,
    [order.id, input.productId, input.quantity, Number(product.price)],
  );

  await queryRunner.query(
    `
      INSERT INTO post_processing_tasks (
        order_id,
        type
      )
      VALUES ($1, 'order_confirmation')
    `,
    [order.id],
  );

  return {
    orderId: order.id,
    totalAmount,
    remainingStock: Number(product.stock_quantity),
  };
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error('Quantity must be a positive integer');
  }

  const queryRunner = AppDataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const result = await executeCheckout(queryRunner, input);

    await queryRunner.commitTransaction();

    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
