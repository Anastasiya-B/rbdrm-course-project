import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { OrderEventsService } from './order-events.service';
import { OrdersService } from './orders.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ZodValidationPipe } from '../validation/zod.pipe';
import { createOrderSchema, paginationSchema, updateOrderStatusSchema } from '../validation/schemas';
import { z } from 'zod';
import { RateLimitGuard } from '../redis/rate-limit.guard';

interface CreateOrderRequest {
  items: Array<{
    product_id: number;
    quantity: number;
  }>;
}

interface UpdateOrderStatusRequest {
  status: string;
}

type Pagination = z.infer<typeof paginationSchema>;

function decodeCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id?: number };
    if (!Number.isInteger(value.id) || Number(value.id) <= 0) throw new Error();
    return Number(value.id);
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  @Post()
  @UseGuards(AuthGuard, RateLimitGuard)
  createOrder(
    @Headers('idempotency-key')
    idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createOrderSchema))
    body: CreateOrderRequest,
    @Req()
    request: AuthenticatedRequest,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    if (!request.user) {
      throw new ForbiddenException('Authenticated user is required');
    }

    return this.ordersService.create(body, idempotencyKey, Number(request.user.sub));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @Patch(':id/status')
  updateOrderStatus(
    @Param('id', ParseIntPipe)
    id: number,
    @Body(new ZodValidationPipe(updateOrderStatusSchema))
    body: UpdateOrderStatusRequest,
    @Req()
    request: AuthenticatedRequest,
  ) {
    if (!request.user) {
      throw new ForbiddenException('Authenticated user is required');
    }

    return this.ordersService.updateStatus(
      id,
      body.status,
      Number(request.user.sub),
      request.user.role,
    );
  }

  @UseGuards(AuthGuard)
  @Get(':id/events')
  async streamOrderEvents(
    @Param('id', ParseIntPipe)
    id: number,
    @Headers('last-event-id')
    lastEventIdHeader: string | undefined,
    @Req()
    request: AuthenticatedRequest,
    @Res()
    response: Response,
  ): Promise<void> {
    if (!request.user || !(await this.ordersService.belongsToUser(id, Number(request.user.sub)))) {
      throw new ForbiddenException('Order belongs to another user');
    }

    const lastEventId = this.parseLastEventId(lastEventIdHeader);

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    response.write('retry: 1000\n\n');

    const missedEvents = this.orderEventsService.getEventsAfter(
      id,
      lastEventId,
    );

    for (const event of missedEvents) {
      this.writeSseEvent(response, event);
    }

    const subscription = this.orderEventsService.events$.subscribe(event => {
      if (event.orderId !== id) {
        return;
      }

      this.writeSseEvent(response, event);
    });

    request.on('close', () => {
      subscription.unsubscribe();
      response.end();
    });
  }

  @UseGuards(AuthGuard)
  @Get()
  async listOrders(
    @Query(new ZodValidationPipe(paginationSchema)) query: Pagination,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user) throw new ForbiddenException('Access denied');
    return this.ordersService.listForUser(
      Number(request.user.sub),
      query.limit,
      decodeCursor(query.cursor),
    );
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  async getOrderById(
    @Param('id', ParseIntPipe)
    id: number,
    @Req()
    request: AuthenticatedRequest,
  ) {
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    const userId = Number(user.sub);

    const belongsToUser = await this.ordersService.belongsToUser(id, userId);

    if (!belongsToUser) {
      throw new ForbiddenException('Order belongs to another user');
    }

    return this.ordersService.findById(id);
  }

  private parseLastEventId(value: string | undefined): number {
    if (!value) {
      return 0;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
      return 0;
    }

    return parsed;
  }

  private writeSseEvent(
    response: Response,
    event: {
      id: number;
      orderId: number;
      status: string;
      occurredAt: string;
    },
  ): void {
    response.write(`id: ${event.id}\n`);

    response.write('event: order.status\n');

    response.write(
      `data: ${JSON.stringify({
        orderId: event.orderId,
        status: event.status,
        occurredAt: event.occurredAt,
      })}\n\n`,
    );
  }
}
