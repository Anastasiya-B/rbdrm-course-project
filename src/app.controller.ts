import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard, type AuthenticatedRequest } from './auth/auth.guard';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { DatabaseService } from './database.service';
import { isReady } from './lifecycle';
import { ZodValidationPipe } from './validation/zod.pipe';
import { createProductSchema, paginationSchema } from './validation/schemas';
import { z } from 'zod';

const startedAt = Date.now();

interface CreateProductRequest {
  name: string;
  description?: string;
  price: number;
  stockQuantity?: number;
}

interface ProductRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  price: number;
  stock_quantity: number;
  is_active: boolean;
}

type Pagination = z.infer<typeof paginationSchema>;

function decodeCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id?: number };
    return Number.isInteger(value.id) && Number(value.id) > 0 ? Number(value.id) : undefined;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id })).toString('base64url');
}

@Controller()
export class AppController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  getRoot() {
    return {
      message: 'Marketplace API',
    };
  }

  /*
   * Liveness:
   * "Is this process alive?"
   *
   * It deliberately does not depend on readiness,
   * database state or downstream services.
   */
  @Get('healthz')
  getHealthz() {
    return {
      status: 'alive',
    };
  }

  /*
   * Readiness:
   * "May Kubernetes send new traffic here?"
   */
  @Get('readyz')
  getReadyz() {
    if (!isReady()) {
      throw new ServiceUnavailableException('not ready');
    }

    return {
      status: 'ready',
    };
  }

  /*
   * Previous course endpoint remains available.
   */
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    };
  }

  @Get('db-check')
  async getDatabaseCheck() {
    const result = await this.databaseService.checkConnection();

    return {
      status: 'ok',
      database: result.message,
    };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @Post('products')
  async createProduct(
    @Req()
    request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createProductSchema))
    validatedBody: CreateProductRequest,
  ) {
    const user = request.user;

    if (!user) {
      throw new BadRequestException('Authenticated user is required');
    }

    const productBody = validatedBody;
    const stockQuantity = productBody.stockQuantity ?? 0;

    const result = await this.databaseService.query<ProductRow>(
      `
          INSERT INTO products (
            owner_id,
            name,
            description,
            price,
            stock_quantity,
            is_active
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            TRUE
          )
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
        Number(user.sub),
        productBody.name.trim(),
        productBody.description ?? null,
        productBody.price,
        stockQuantity,
      ],
    );

    const product = result.rows[0];

    if (!product) {
      throw new Error('Failed to create product');
    }

    return {
      id: Number(product.id),
      owner_id: Number(product.owner_id),
      name: product.name,
      description: product.description,
      price: Number(product.price),
      stock_quantity: product.stock_quantity,
      is_active: product.is_active,
    };
  }

  @Get('products')
  async listProducts(
    @Query(new ZodValidationPipe(paginationSchema)) query: Pagination,
  ) {
    const afterId = decodeCursor(query.cursor);
    const result = await this.databaseService.query<ProductRow>(
      `
        SELECT id, owner_id, name, description, price, stock_quantity, is_active
        FROM products
        WHERE is_active = TRUE
          AND ($1::bigint IS NULL OR id > $1)
        ORDER BY id
        LIMIT $2
      `,
      [afterId ?? null, query.limit + 1],
    );
    const hasNext = result.rows.length > query.limit;
    const rows = hasNext ? result.rows.slice(0, query.limit) : result.rows;
    return {
      items: rows.map(product => ({
        id: Number(product.id),
        name: product.name,
        price_cents: Number(product.price),
      })),
      next_cursor: hasNext ? encodeCursor(Number(rows[rows.length - 1].id)) : null,
    };
  }
}
