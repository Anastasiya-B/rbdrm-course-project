import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProcessedOrderEvents1790762400000
  implements MigrationInterface
{
  name = 'AddProcessedOrderEvents1790762400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE processed_order_events (
        event_id varchar(100) PRIMARY KEY,
        order_id bigint NOT NULL,
        event_type varchar(100) NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_processed_order_events_order_id
      ON processed_order_events (order_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE processed_order_events
    `);
  }
}
