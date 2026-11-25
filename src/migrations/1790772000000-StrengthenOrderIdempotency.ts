import { MigrationInterface, QueryRunner } from 'typeorm';

export class StrengthenOrderIdempotency1790772000000 implements MigrationInterface {
  name = 'StrengthenOrderIdempotency1790772000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE idempotency_keys
        DROP CONSTRAINT idempotency_keys_pkey
    `);
    await queryRunner.query(`
      ALTER TABLE idempotency_keys
        ADD COLUMN IF NOT EXISTS user_id bigint NULL REFERENCES users(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS operation varchar(100) NOT NULL DEFAULT 'create_order',
        ADD COLUMN IF NOT EXISTS request_fingerprint varchar(64) NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_idempotency_keys_user_operation
      ON idempotency_keys (user_id, operation, idempotency_key)
      WHERE user_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_idempotency_keys_user_operation`);
    await queryRunner.query(`ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (idempotency_key)`);
    await queryRunner.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS request_fingerprint`);
    await queryRunner.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS operation`);
    await queryRunner.query(`ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS user_id`);
  }
}
