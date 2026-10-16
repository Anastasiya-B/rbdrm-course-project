import type { Queryable } from './queryable';

export interface CreateUserInput {
  email: string;
  fullName: string;
  balance?: number;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  balance: number;
}

export class UserRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateUserInput): Promise<UserRow> {
    const result = await this.db.query<UserRow>(
      `
        INSERT INTO users (email, full_name, balance)
        VALUES ($1, $2, $3)
        RETURNING id, email, full_name, balance
      `,
      [input.email, input.fullName, input.balance ?? 0],
    );

    return result.rows[0];
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      `
        SELECT id, email, full_name, balance
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email],
    );

    return result.rows[0] ?? null;
  }

  async createIfMissing(input: CreateUserInput): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      `
        INSERT INTO users (email, full_name, balance)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email, full_name, balance
      `,
      [input.email, input.fullName, input.balance ?? 0],
    );

    return result.rows[0] ?? null;
  }
}
