import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { Order, OrderItem, Product, User } from './entities';

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function getPort(): number {
  const value = getRequiredEnv('DB_PORT');
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('DB_PORT must be a positive integer');
  }

  return port;
}

const AppDataSource = new DataSource({
  type: 'postgres',
  host: getRequiredEnv('DB_HOST'),
  port: getPort(),
  username: getRequiredEnv('DB_USER'),
  password: getRequiredEnv('DB_PASSWORD'),
  database: getRequiredEnv('DB_NAME'),
  entities: [User, Product, Order, OrderItem],
  migrations: [`${__dirname}/migrations/*.{js,ts}`],
  synchronize: false,
  logging: false,
});

export default AppDataSource;
