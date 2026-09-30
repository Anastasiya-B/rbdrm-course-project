import 'reflect-metadata';

import AppDataSource from './data-source';
import { checkout, CheckoutError } from './checkout';

const ATTEMPTS = 50;
const PRODUCT_ID = '1';
const INITIAL_STOCK = 10;
const BUYERS = 10;

interface StockRow {
  stock_quantity: number;
}

interface CountRow {
  count: string;
}

async function resetRaceState(): Promise<void> {
  await AppDataSource.query(`
    DELETE FROM orders
    WHERE id > 10
  `);

  await AppDataSource.query(
    `
      UPDATE products
      SET stock_quantity = $1
      WHERE id = $2
    `,
    [INITIAL_STOCK, PRODUCT_ID],
  );

  await AppDataSource.query(`
    UPDATE users
    SET balance = 10000000
    WHERE id BETWEEN 1 AND 10
  `);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    await resetRaceState();

    const attempts = Array.from({ length: ATTEMPTS }, (_, index) => {
      const userId = String((index % BUYERS) + 1);

      return checkout({
        userId,
        productId: PRODUCT_ID,
        quantity: 1,
      })
        .then(() => ({
          success: true,
        }))
        .catch(error => {
          if (
            error instanceof CheckoutError &&
            error.code === 'INSUFFICIENT_STOCK'
          ) {
            return {
              success: false,
            };
          }

          throw error;
        });
    });

    const results = await Promise.all(attempts);

    const successful = results.filter(result => result.success).length;

    const stockRows = (await AppDataSource.query(
      `
        SELECT stock_quantity
        FROM products
        WHERE id = $1
      `,
      [PRODUCT_ID],
    )) as StockRow[];

    const finalStock = stockRows[0]?.stock_quantity;

    const negativeRows = (await AppDataSource.query(`
        SELECT COUNT(*) AS count
        FROM products
        WHERE stock_quantity < 0
      `)) as CountRow[];

    const negativeStockRows = Number(negativeRows[0]?.count ?? 0);

    console.log('\n=== Race result ===');
    console.log(`Attempts: ${ATTEMPTS}`);
    console.log(`Successful: ${successful}`);
    console.log(`Final stock: ${finalStock}`);
    console.log(`Negative stock rows: ${negativeStockRows}`);

    const invariantPassed =
      successful === INITIAL_STOCK &&
      finalStock === 0 &&
      negativeStockRows === 0;

    console.log(`Invariant passed: ${invariantPassed}`);

    if (!invariantPassed) {
      process.exitCode = 1;
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('Race demo failed:', error);

  process.exit(1);
});
