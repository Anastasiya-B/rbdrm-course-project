import type { Queryable } from './queryable';

export interface CreateProductInput {
  ownerId: string;
  name: string;
  description?: string | null;
  price: number;
  stockQuantity?: number;
  isActive?: boolean;
}

export interface ProductRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  price: number;
  stock_quantity: number;
  is_active: boolean;
}

export interface ProductWithOwnerRow extends ProductRow {
  owner_email: string;
  owner_full_name: string;
}

export class ProductRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateProductInput): Promise<ProductRow> {
    const result = await this.db.query<ProductRow>(
      `
        INSERT INTO products (
          owner_id,
          name,
          description,
          price,
          stock_quantity,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          owner_id,
          name,
          description,
          price,
          stock_quantity,
          is_active
      `,
      [
        input.ownerId,
        input.name,
        input.description ?? null,
        input.price,
        input.stockQuantity ?? 0,
        input.isActive ?? true,
      ],
    );

    return result.rows[0];
  }

  async findById(id: string): Promise<ProductRow | null> {
    const result = await this.db.query<ProductRow>(
      `
        SELECT
          id,
          owner_id,
          name,
          description,
          price,
          stock_quantity,
          is_active
        FROM products
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async findWithOwner(id: string): Promise<ProductWithOwnerRow | null> {
    const result = await this.db.query<ProductWithOwnerRow>(
      `
        SELECT
          p.id,
          p.owner_id,
          p.name,
          p.description,
          p.price,
          p.stock_quantity,
          p.is_active,
          u.email AS owner_email,
          u.full_name AS owner_full_name
        FROM products p
        JOIN users u ON u.id = p.owner_id
        WHERE p.id = $1
        LIMIT 1
      `,
      [id],
    );

    return result.rows[0] ?? null;
  }
}
