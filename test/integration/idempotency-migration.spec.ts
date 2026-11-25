import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { AddAccessTokenDenylist1790770800000 } from '../../src/migrations/1790770800000-AddAccessTokenDenylist';
import { AddCheckoutConcurrency1790758800000 } from '../../src/migrations/1790758800000-AddCheckoutConcurrency';
import { AddFiles1790771400000 } from '../../src/migrations/1790771400000-AddFiles';
import { AddProcessedOrderEvents1790762400000 } from '../../src/migrations/1790762400000-AddProcessedOrderEvents';
import { AddRefreshTokens1790769600000 } from '../../src/migrations/1790769600000-AddRefreshTokens';
import { AddTransactionalOutbox1790766000000 } from '../../src/migrations/1790766000000-AddTransactionalOutbox';
import { AddUserAuthFields1790770200000 } from '../../src/migrations/1790770200000-AddUserAuthFields';
import { InitialSchema1790585877116 } from '../../src/migrations/1790585877116-InitialSchema';
import { StrengthenOrderIdempotency1790772000000 } from '../../src/migrations/1790772000000-StrengthenOrderIdempotency';

describe('idempotency migration', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      migrations: [
        InitialSchema1790585877116,
        AddCheckoutConcurrency1790758800000,
        AddProcessedOrderEvents1790762400000,
        AddTransactionalOutbox1790766000000,
        AddRefreshTokens1790769600000,
        AddUserAuthFields1790770200000,
        AddAccessTokenDenylist1790770800000,
        AddFiles1790771400000,
        StrengthenOrderIdempotency1790772000000,
      ],
      synchronize: false,
    });
    await dataSource.initialize();

    await dataSource.query(`
      CREATE TABLE typeorm_metadata (
        type varchar(255) NOT NULL,
        database varchar(255),
        schema varchar(255),
        "table" varchar(255),
        name varchar(255),
        value text
      )
    `);

    await dataSource.runMigrations({ transaction: 'all' });
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  it('supports legacy rows, user-scoped uniqueness, and reversal', async () => {
    await dataSource.query(`
      INSERT INTO users (email, full_name)
      VALUES
        ('migration@example.com', 'Migration User'),
        ('migration-two@example.com', 'Migration User Two')
    `);

    await dataSource.query(`
      INSERT INTO idempotency_keys (idempotency_key)
      VALUES ('legacy-key')
    `);

    await dataSource.query(`
      INSERT INTO idempotency_keys (
        idempotency_key, user_id, operation, request_fingerprint
      )
      VALUES
        ('shared-key', 1, 'create_order', repeat('a', 64)),
        ('shared-key', 2, 'create_order', repeat('b', 64))
    `);

    const columns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'idempotency_keys'
        AND column_name IN ('user_id', 'operation', 'request_fingerprint')
    `);
    expect(columns).toHaveLength(3);

    await dataSource.query(`
      DELETE FROM idempotency_keys WHERE idempotency_key = 'shared-key'
    `);

    await dataSource.undoLastMigration();

    const revertedColumns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'idempotency_keys'
        AND column_name IN ('user_id', 'operation', 'request_fingerprint')
    `);
    expect(revertedColumns).toHaveLength(0);

    const legacy = await dataSource.query(
      `SELECT idempotency_key FROM idempotency_keys WHERE idempotency_key = 'legacy-key'`,
    );
    expect(legacy).toHaveLength(1);
  });
});
