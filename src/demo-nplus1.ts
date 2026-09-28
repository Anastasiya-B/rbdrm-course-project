import 'reflect-metadata';

import { DataSource, Logger, QueryRunner } from 'typeorm';

import AppDataSource from './data-source';
import { Order, OrderItem, Product } from './entities';

class QueryCountLogger implements Logger {
  private count = 0;

  get queryCount(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }

  logQuery(
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    this.count += 1;

    const params =
      parameters && parameters.length > 0
        ? ` -- PARAMETERS: ${JSON.stringify(parameters)}`
        : '';

    console.log(`SQL #${this.count}: ${query}${params}`);
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    console.error('Query failed:', error);
    console.error(query, parameters ?? []);
  }

  logQuerySlow(
    time: number,
    query: string,
    parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    console.warn(`Slow query (${time} ms):`, query, parameters ?? []);
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    console.log(message);
  }

  logMigration(message: string, _queryRunner?: QueryRunner): void {
    console.log(message);
  }

  log(
    level: 'log' | 'info' | 'warn',
    message: unknown,
    _queryRunner?: QueryRunner,
  ): void {
    if (level === 'warn') {
      console.warn(message);
      return;
    }

    console.log(message);
  }
}

function createOrderIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(index + 1));
}

async function runNaiveDemo(
  dataSource: DataSource,
  logger: QueryCountLogger,
  orderIds: string[],
): Promise<number> {
  const orderRepository = dataSource.getRepository(Order);

  const orderItemRepository = dataSource.getRepository(OrderItem);

  const productRepository = dataSource.getRepository(Product);

  logger.reset();

  const orders = await orderRepository
    .createQueryBuilder('order')
    .where('order.id IN (:...orderIds)', {
      orderIds,
    })
    .orderBy('order.id', 'ASC')
    .getMany();

  for (const order of orders) {
    const items = await orderItemRepository.find({
      where: {
        orderId: order.id,
      },
      order: {
        id: 'ASC',
      },
    });

    for (const item of items) {
      await productRepository.findOneByOrFail({
        id: item.productId,
      });
    }
  }

  console.log(`Collection size (N): ${orders.length}`);
  console.log(`Naive SQL queries: ${logger.queryCount}`);

  return logger.queryCount;
}

async function runOptimizedDemo(
  dataSource: DataSource,
  logger: QueryCountLogger,
  orderIds: string[],
): Promise<number> {
  const orderRepository = dataSource.getRepository(Order);

  logger.reset();

  const orders = await orderRepository
    .createQueryBuilder('order')
    .leftJoinAndSelect('order.items', 'item')
    .leftJoinAndSelect('item.product', 'product')
    .where('order.id IN (:...orderIds)', {
      orderIds,
    })
    .orderBy('order.id', 'ASC')
    .addOrderBy('item.id', 'ASC')
    .getMany();

  console.log(`Collection size (N): ${orders.length}`);
  console.log(`Optimized SQL queries: ${logger.queryCount}`);

  return logger.queryCount;
}

async function runScenario(
  dataSource: DataSource,
  logger: QueryCountLogger,
  size: number,
): Promise<{
  size: number;
  before: number;
  after: number;
}> {
  const orderIds = createOrderIds(size);

  console.log(`\n=== N+1 demo for N = ${size} ===`);

  console.log('\n--- Naive ---\n');

  const before = await runNaiveDemo(dataSource, logger, orderIds);

  console.log('\n--- Optimized ---\n');

  const after = await runOptimizedDemo(dataSource, logger, orderIds);

  return {
    size,
    before,
    after,
  };
}

async function main(): Promise<void> {
  const logger = new QueryCountLogger();

  const dataSource = new DataSource({
    ...AppDataSource.options,
    logging: ['query'],
    logger,
  });

  await dataSource.initialize();

  try {
    const smallScenario = await runScenario(dataSource, logger, 5);

    const largeScenario = await runScenario(dataSource, logger, 10);

    console.log('\n=== Summary ===');

    console.log(
      `N = ${smallScenario.size}: ` +
        `before ${smallScenario.before}, ` +
        `after ${smallScenario.after}`,
    );

    console.log(
      `N = ${largeScenario.size}: ` +
        `before ${largeScenario.before}, ` +
        `after ${largeScenario.after}`,
    );

    console.log(
      `Optimized query count is constant: ${
        smallScenario.after === largeScenario.after
      }`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch(error => {
  console.error('N+1 demo failed:', error);

  process.exit(1);
});
