import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard, type AuthenticatedRequest } from './auth/auth.guard';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { DatabaseService } from './database.service';

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

@Controller()
export class AppController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  getRoot() {
    return {
      message: 'Marketplace API',
    };
  }

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
    @Body()
    body: CreateProductRequest,
  ) {
    const user = request.user;

    if (!user) {
      throw new BadRequestException('Authenticated user is required');
    }

    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new BadRequestException('Product name is required');
    }

    if (!Number.isInteger(body.price) || body.price <= 0) {
      throw new BadRequestException('Product price must be a positive integer');
    }

    const stockQuantity = body.stockQuantity ?? 0;

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      throw new BadRequestException(
        'Stock quantity must be a non-negative integer',
      );
    }

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
        body.name.trim(),
        body.description ?? null,
        body.price,
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
}
