import 'reflect-metadata';

import AppDataSource from './data-source';

async function seed(): Promise<void> {
  await AppDataSource.initialize();

  const queryRunner = AppDataSource.createQueryRunner();

  try {
    await queryRunner.connect();
    await queryRunner.startTransaction();

    await queryRunner.query(`
      INSERT INTO users (id, email, full_name)
      VALUES
        (1, 'anna@example.com', 'Анна Коваль'),
        (2, 'oleh@example.com', 'Олег Бондар'),
        (3, 'maria@example.com', 'Марія Шевченко'),
        (4, 'ivan@example.com', 'Іван Мельник'),
        (5, 'olena@example.com', 'Олена Ткаченко'),
        (6, 'taras@example.com', 'Тарас Кравченко'),
        (7, 'sofia@example.com', 'Софія Левченко'),
        (8, 'andrii@example.com', 'Андрій Савчук'),
        (9, 'natalia@example.com', 'Наталія Мороз'),
        (10, 'maksym@example.com', 'Максим Ковальчук')
      ON CONFLICT (id) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO products (
        id,
        owner_id,
        name,
        description,
        price,
        stock_quantity,
        is_active
      )
      VALUES
        (
          1,
          1,
          'Шкіряні кросівки',
          'Зручні шкіряні кросівки для щоденних прогулянок містом',
          249900,
          15,
          true
        ),
        (
          2,
          2,
          'Міська сумка',
          'Практична міська сумка для роботи та подорожей',
          129900,
          20,
          true
        ),
        (
          3,
          3,
          'Ігровий ноутбук',
          'Потужний ноутбук для роботи та сучасних ігор',
          4599900,
          5,
          true
        ),
        (
          4,
          4,
          'Бездротові навушники',
          'Компактні навушники з якісним звуком',
          349900,
          30,
          true
        ),
        (
          5,
          5,
          'Механічна клавіатура',
          'Механічна клавіатура для програмування та ігор',
          289900,
          12,
          true
        ),
        (
          6,
          6,
          'Компʼютерна миша',
          'Ергономічна бездротова миша',
          159900,
          25,
          true
        ),
        (
          7,
          7,
          'Монітор 27 дюймів',
          'Монітор високої роздільної здатності для роботи',
          899900,
          8,
          true
        ),
        (
          8,
          8,
          'Рюкзак для ноутбука',
          'Міський рюкзак із відділенням для ноутбука',
          199900,
          18,
          true
        ),
        (
          9,
          9,
          'USB-C хаб',
          'Багатофункціональний адаптер для ноутбука',
          179900,
          35,
          true
        ),
        (
          10,
          10,
          'Вебкамера',
          'Вебкамера для відеодзвінків та конференцій',
          219900,
          14,
          true
        )
      ON CONFLICT (id) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO orders (
        id,
        user_id,
        status,
        total_amount
      )
      VALUES
        (1, 1, 'completed', 379800),
        (2, 2, 'paid', 4599900),
        (3, 3, 'shipped', 639800),
        (4, 4, 'created', 899900),
        (5, 5, 'completed', 489800),
        (6, 6, 'paid', 179900),
        (7, 7, 'completed', 349900),
        (8, 8, 'cancelled', 219900),
        (9, 9, 'shipped', 289900),
        (10, 10, 'created', 329800)
      ON CONFLICT (id) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO order_items (
        id,
        order_id,
        product_id,
        quantity,
        unit_price
      )
      VALUES
        (1, 1, 1, 1, 249900),
        (2, 1, 2, 1, 129900),

        (3, 2, 3, 1, 4599900),

        (4, 3, 4, 1, 349900),
        (5, 3, 5, 1, 289900),

        (6, 4, 7, 1, 899900),

        (7, 5, 5, 1, 289900),
        (8, 5, 8, 1, 199900),

        (9, 6, 9, 1, 179900),

        (10, 7, 4, 1, 349900),

        (11, 8, 10, 1, 219900),

        (12, 9, 5, 1, 289900),

        (13, 10, 6, 1, 159900),
        (14, 10, 9, 1, 169900)
      ON CONFLICT (id) DO NOTHING
    `);

    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('users', 'id'),
        COALESCE((SELECT MAX(id) FROM users), 1),
        true
      )
    `);

    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('products', 'id'),
        COALESCE((SELECT MAX(id) FROM products), 1),
        true
      )
    `);

    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('orders', 'id'),
        COALESCE((SELECT MAX(id) FROM orders), 1),
        true
      )
    `);

    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('order_items', 'id'),
        COALESCE((SELECT MAX(id) FROM order_items), 1),
        true
      )
    `);

    await queryRunner.commitTransaction();

    console.log('Seed completed successfully.');
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
    await AppDataSource.destroy();
  }
}

seed().catch(error => {
  console.error('Seed failed:', error);
  process.exit(1);
});
