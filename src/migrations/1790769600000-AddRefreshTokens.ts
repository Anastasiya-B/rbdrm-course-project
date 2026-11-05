import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokens1790769600000 implements MigrationInterface {
  name = 'AddRefreshTokens1790769600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id bigserial PRIMARY KEY,
        token_hash varchar(128) NOT NULL UNIQUE,
        family_id uuid NOT NULL,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        used_at timestamptz NULL,
        revoked_at timestamptz NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_refresh_tokens_token_hash
      ON refresh_tokens (token_hash)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_refresh_tokens_family_id
      ON refresh_tokens (family_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_refresh_tokens_user_id
      ON refresh_tokens (user_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS refresh_tokens
    `);
  }
}
