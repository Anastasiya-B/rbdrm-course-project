import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentProcessing1790773200000 implements MigrationInterface {
  name = 'AddPaymentProcessing1790773200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payment_operations (
        operation_key varchar(200) PRIMARY KEY,
        order_id bigint NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        amount integer NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'completed',
        provider_event_id varchar(200),
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        CONSTRAINT payment_operations_amount_positive CHECK (amount > 0),
        CONSTRAINT payment_operations_status_valid CHECK (status IN ('completed'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE payment_provider_events (
        provider_event_id varchar(200) PRIMARY KEY,
        operation_key varchar(200) NOT NULL,
        payload_hash varchar(64) NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS payment_provider_events');
    await queryRunner.query('DROP TABLE IF EXISTS payment_operations');
  }
}
