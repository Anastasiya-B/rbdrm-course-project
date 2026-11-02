import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccessTokenDenylist1790770800000 implements MigrationInterface {
  name = 'AddAccessTokenDenylist1790770800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE access_token_denylist (
        jti uuid PRIMARY KEY,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_access_token_denylist_expires_at
      ON access_token_denylist (expires_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS access_token_denylist
    `);
  }
}
