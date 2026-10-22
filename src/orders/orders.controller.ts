import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';

import { OrdersService } from './orders.service';

interface CreateOrderRequest {
  items: Array<{
    product_id: number;
    quantity: number;
  }>;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateOrderRequest,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return this.ordersService.create(body);
  }

  @Get(':id')
  getOrderById(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findById(id);
  }
}
