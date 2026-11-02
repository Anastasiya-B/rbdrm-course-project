import AppDataSource from '../data-source';
import { getOrLoadCached } from './cache';

interface ProductSummaryRow {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
}

export interface ProductSummary {
  id: number;
  name: string;
  price: number;
  stockQuantity: number;
}

let databaseCalls = 0;

export function resetDatabaseCallCount(): void {
  databaseCalls = 0;
}

export function getDatabaseCallCount(): number {
  return databaseCalls;
}

async function loadProductFromDatabase(
  productId: number,
): Promise<ProductSummary> {
  databaseCalls += 1;

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const rows = (await AppDataSource.query(
    `
      SELECT
        id,
        name,
        price,
        stock_quantity
      FROM products
      WHERE id = $1
      LIMIT 1
    `,
    [productId],
  )) as ProductSummaryRow[];

  const row = rows[0];

  if (!row) {
    throw new Error(`Product ${productId} not found`);
  }

  return {
    id: Number(row.id),
    name: row.name,
    price: Number(row.price),
    stockQuantity: Number(row.stock_quantity),
  };
}

export async function getProductSummaryCached(
  productId: number,
): Promise<ProductSummary> {
  return getOrLoadCached(`product-summary:${productId}`, () =>
    loadProductFromDatabase(productId),
  );
}
