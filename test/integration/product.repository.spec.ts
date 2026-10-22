import type { PoolClient } from 'pg';

import { ProductRepository } from '../../src/repositories/product.repository';
import { UserRepository } from '../../src/repositories/user.repository';
import { aProduct, aUser } from './testkit/builders';
import {
  IntegrationDatabase,
  rollbackTestTransaction,
  startIntegrationDatabase,
  startTestTransaction,
  stopIntegrationDatabase,
} from './testkit/postgres';

describe('ProductRepository integration', () => {
  let database: IntegrationDatabase;
  let client: PoolClient;
  let productRepository: ProductRepository;
  let userRepository: UserRepository;

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
    productRepository = new ProductRepository(client);
    userRepository = new UserRepository(client);
  });

  afterEach(async () => {
    if (client) {
      await rollbackTestTransaction(client);
    }
  });

  it('creates and finds a product by id', async () => {
    const user = await userRepository.create(aUser());
    const input = aProduct(user.id);

    const created = await productRepository.create(input);
    const found = await productRepository.findById(created.id);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe(input.name);
    expect(found?.price).toBe(input.price);
  });

  it('loads a product with its owner using JOIN', async () => {
    const userInput = aUser();
    const user = await userRepository.create(userInput);
    const product = await productRepository.create(aProduct(user.id));

    const result = await productRepository.findWithOwner(product.id);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(product.id);
    expect(result?.owner_email).toBe(userInput.email);
    expect(result?.owner_full_name).toBe(userInput.fullName);
  });

  it('enforces the product owner foreign key constraint', async () => {
    const input = aProduct('999999999');

    await expect(productRepository.create(input)).rejects.toMatchObject({
      code: '23503',
    });
  });
});
