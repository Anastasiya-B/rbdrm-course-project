import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionalOutbox1790766000000 implements MigrationInterface {
  name = 'AddTransactionalOutbox1790766000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE outbox_messages (
        id bigserial PRIMARY KEY,
        event_id varchar(150) NOT NULL UNIQUE,
        aggregate_type varchar(100) NOT NULL,
        aggregate_id varchar(100) NOT NULL,
        type varchar(150) NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz NULL,
        attempts integer NOT NULL DEFAULT 0
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_outbox_messages_unpublished
      ON outbox_messages (created_at, id)
      WHERE published_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE processed_messages (
        message_id varchar(150) NOT NULL,
        consumer varchar(150) NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, consumer)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE order_event_effects (
        message_id varchar(150) PRIMARY KEY,
        order_id bigint NOT NULL,
        event_type varchar(150) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        idempotency_key varchar(200) PRIMARY KEY,
        order_id bigint NULL REFERENCES orders(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS idempotency_keys
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS order_event_effects
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS processed_messages
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS outbox_messages
    `);
  }
}
