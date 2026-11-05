import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFiles1790771400000 implements MigrationInterface {
  name = 'AddFiles1790771400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE files (
        id uuid PRIMARY KEY,
        owner_id bigint NOT NULL,
        object_key varchar(1024) NOT NULL UNIQUE,
        content_type varchar(255) NOT NULL,
        status varchar(30) NOT NULL,
        expected_size bigint NULL,
        actual_size bigint NULL,
        upload_id text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz NULL,

        CONSTRAINT files_owner_fk
          FOREIGN KEY (owner_id)
          REFERENCES users(id)
          ON DELETE CASCADE,

        CONSTRAINT files_status_check
          CHECK (
            status IN (
              'PENDING',
              'COMPLETED'
            )
          ),

        CONSTRAINT files_expected_size_check
          CHECK (
            expected_size IS NULL
            OR expected_size >= 0
          ),

        CONSTRAINT files_actual_size_check
          CHECK (
            actual_size IS NULL
            OR actual_size >= 0
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_files_owner_id
      ON files (owner_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_files_status_created_at
      ON files (status, created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS files
    `);
  }
}
