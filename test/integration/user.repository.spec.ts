import type { PoolClient } from 'pg';

import { UserRepository } from '../../src/repositories/user.repository';
import { aUser } from './testkit/builders';
import {
  IntegrationDatabase,
  rollbackTestTransaction,
  startIntegrationDatabase,
  startTestTransaction,
  stopIntegrationDatabase,
} from './testkit/postgres';

describe('UserRepository integration', () => {
  let database: IntegrationDatabase;
  let client: PoolClient;
  let repository: UserRepository;

  beforeAll(async () => {
    database = await startIntegrationDatabase();
  });

  afterAll(async () => {
    if (database) {
      await stopIntegrationDatabase(database);
    }
  });

  beforeEach(async () => {
    client = await startTestTransaction(database.pool);
    repository = new UserRepository(client);
  });

  afterEach(async () => {
    if (client) {
      await rollbackTestTransaction(client);
    }
  });

  it('creates and finds a user by email', async () => {
    const input = aUser();

    const created = await repository.create(input);
    const found = await repository.findByEmail(input.email);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.email).toBe(input.email);
    expect(found?.full_name).toBe(input.fullName);
  });

  it('enforces the unique email constraint', async () => {
    const input = aUser();

    await repository.create(input);

    await expect(repository.create(input)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('uses ON CONFLICT to ignore an existing email', async () => {
    const input = aUser();

    const first = await repository.createIfMissing(input);
    const second = await repository.createIfMissing(input);

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const found = await repository.findByEmail(input.email);

    expect(found?.email).toBe(input.email);
  });
});
