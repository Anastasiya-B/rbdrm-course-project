import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1790585877116 implements MigrationInterface {
  name = 'InitialSchema1790585877116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'marketplace',
        'public',
        'products',
        'GENERATED_COLUMN',
        'search_vector',
        "to_tsvector('simple', name || ' ' || description)",
      ],
    );

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" BIGSERIAL NOT NULL,
        "owner_id" bigint NOT NULL,
        "name" text NOT NULL,
        "description" text NOT NULL,
        "price" integer NOT NULL,
        "stock_quantity" integer NOT NULL DEFAULT '0',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "search_vector" tsvector GENERATED ALWAYS AS (
          to_tsvector('simple', name || ' ' || description)
        ) STORED NOT NULL,
        CONSTRAINT "products_stock_non_negative"
          CHECK (stock_quantity >= 0),
        CONSTRAINT "products_price_positive"
          CHECK (price > 0),
        CONSTRAINT "products_description_not_empty"
          CHECK (length(trim(description)) > 0),
        CONSTRAINT "products_name_not_empty"
          CHECK (length(trim(name)) > 0),
        CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `COMMENT ON COLUMN "products"."price" IS 'Price in minor currency units'`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" BIGSERIAL NOT NULL,
        "email" text NOT NULL,
        "full_name" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"
          UNIQUE ("email"),
        CONSTRAINT "users_full_name_not_empty"
          CHECK (length(trim(full_name)) > 0),
        CONSTRAINT "users_email_not_empty"
          CHECK (length(trim(email)) > 0),
        CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" BIGSERIAL NOT NULL,
        "user_id" bigint NOT NULL,
        "status" text NOT NULL DEFAULT 'created',
        "total_amount" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "orders_status_valid"
          CHECK (
            status IN (
              'created',
              'paid',
              'shipped',
              'completed',
              'cancelled'
            )
          ),
        CONSTRAINT "orders_total_non_negative"
          CHECK (total_amount >= 0),
        CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `COMMENT ON COLUMN "orders"."total_amount" IS 'Order total in minor currency units'`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" BIGSERIAL NOT NULL,
        "order_id" bigint NOT NULL,
        "product_id" bigint NOT NULL,
        "quantity" integer NOT NULL,
        "unit_price" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "order_items_price_positive"
          CHECK (unit_price > 0),
        CONSTRAINT "order_items_quantity_positive"
          CHECK (quantity > 0),
        CONSTRAINT "PK_005269d8574e6fac0493715c308"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `COMMENT ON COLUMN "order_items"."unit_price" IS 'Unit price in minor currency units'`,
    );

    await queryRunner.query(`
      CREATE INDEX "idx_orders_user_created_at"
      ON "orders" ("user_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_order_items_order_id"
      ON "order_items" ("order_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_lower_email"
      ON "users" (lower("email"))
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_products_search_vector"
      ON "products"
      USING GIN ("search_vector")
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
      ADD CONSTRAINT "products_owner_fk"
      FOREIGN KEY ("owner_id")
      REFERENCES "users"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD CONSTRAINT "orders_user_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD CONSTRAINT "order_items_order_fk"
      FOREIGN KEY ("order_id")
      REFERENCES "orders"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD CONSTRAINT "order_items_product_fk"
      FOREIGN KEY ("product_id")
      REFERENCES "products"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
      DROP CONSTRAINT "order_items_product_fk"
    `);

    await queryRunner.query(`
      ALTER TABLE "order_items"
      DROP CONSTRAINT "order_items_order_fk"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
      DROP CONSTRAINT "orders_user_fk"
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
      DROP CONSTRAINT "products_owner_fk"
    `);

    await queryRunner.query(`DROP INDEX "public"."idx_products_search_vector"`);

    await queryRunner.query(`DROP INDEX "public"."idx_users_lower_email"`);

    await queryRunner.query(`DROP INDEX "public"."idx_order_items_order_id"`);

    await queryRunner.query(`DROP INDEX "public"."idx_orders_user_created_at"`);

    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "products"`);

    await queryRunner.query(
      `DELETE FROM "typeorm_metadata"
       WHERE "type" = $1
         AND "name" = $2
         AND "database" = $3
         AND "schema" = $4
         AND "table" = $5`,
      [
        'GENERATED_COLUMN',
        'search_vector',
        'marketplace',
        'public',
        'products',
      ],
    );
  }
}
