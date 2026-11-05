import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAuthFields1790770200000 implements MigrationInterface {
  name = 'AddUserAuthFields1790770200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash varchar(255)
    `);

    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role varchar(30)
      NOT NULL DEFAULT 'buyer'
    `);

    await queryRunner.query(`
      ALTER TABLE users
      ADD CONSTRAINT chk_users_role
      CHECK (role IN ('buyer', 'seller', 'admin'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS chk_users_role
    `);

    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS role
    `);

    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS password_hash
    `);
  }
}
