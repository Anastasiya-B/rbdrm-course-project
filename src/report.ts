import 'reflect-metadata';

import AppDataSource from './data-source';
import { OrderItem } from './entities';

interface ProductRevenueRow {
  productId: string;
  productName: string;
  ordersCount: string;
  unitsSold: string;
  revenue: string;
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const orderItemRepository = AppDataSource.getRepository(OrderItem);

    const report = await orderItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.product', 'product')
      .innerJoin('item.order', 'order')
      .select('product.id', 'productId')
      .addSelect('product.name', 'productName')
      .addSelect('COUNT(DISTINCT order.id)', 'ordersCount')
      .addSelect('SUM(item.quantity)', 'unitsSold')
      .addSelect('SUM(item.quantity * item.unit_price)', 'revenue')
      .where('order.status != :cancelledStatus', {
        cancelledStatus: 'cancelled',
      })
      .groupBy('product.id')
      .addGroupBy('product.name')
      .orderBy('revenue', 'DESC')
      .getRawMany<ProductRevenueRow>();

    console.log('Product revenue report');
    console.table(
      report.map(row => ({
        productId: row.productId,
        productName: row.productName,
        ordersCount: Number(row.ordersCount),
        unitsSold: Number(row.unitsSold),
        revenueMinorUnits: Number(row.revenue),
      })),
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch(error => {
  console.error('Report failed:', error);
  process.exit(1);
});
