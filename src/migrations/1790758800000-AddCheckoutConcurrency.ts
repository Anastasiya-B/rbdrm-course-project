import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckoutConcurrency1790758800000 implements MigrationInterface {
  name = 'AddCheckoutConcurrency1790758800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "balance" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "users_balance_non_negative"
      CHECK ("balance" >= 0)
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "users"."balance"
      IS 'Balance in minor currency units'
    `);

    await queryRunner.query(`
      CREATE TABLE "post_processing_tasks" (
        "id" BIGSERIAL NOT NULL,
        "order_id" bigint NOT NULL,
        "type" text NOT NULL DEFAULT 'order_confirmation',
        "status" text NOT NULL DEFAULT 'pending',
        "processed" integer NOT NULL DEFAULT 0,
        "worker_id" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "post_processing_tasks_status_valid"
          CHECK ("status" IN ('pending', 'done')),
        CONSTRAINT "post_processing_tasks_processed_non_negative"
          CHECK ("processed" >= 0),
        CONSTRAINT "PK_post_processing_tasks"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_post_processing_tasks_status_id"
      ON "post_processing_tasks" ("status", "id")
    `);

    await queryRunner.query(`
      ALTER TABLE "post_processing_tasks"
      ADD CONSTRAINT "post_processing_tasks_order_fk"
      FOREIGN KEY ("order_id")
      REFERENCES "orders"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "post_processing_tasks"
      DROP CONSTRAINT "post_processing_tasks_order_fk"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."idx_post_processing_tasks_status_id"
    `);

    await queryRunner.query(`
      DROP TABLE "post_processing_tasks"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP CONSTRAINT "users_balance_non_negative"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "balance"
    `);
  }
}
