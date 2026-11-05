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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { OrderEventsService } from './order-events.service';
import { OrdersService } from './orders.service';

interface CreateOrderRequest {
  items: Array<{
    product_id: number;
    quantity: number;
  }>;
}

interface UpdateOrderStatusRequest {
  status: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  @Post()
  createOrder(
    @Headers('idempotency-key')
    idempotencyKey: string | undefined,
    @Body()
    body: CreateOrderRequest,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return this.ordersService.create(body, idempotencyKey);
  }

  @Patch(':id/status')
  updateOrderStatus(
    @Param('id', ParseIntPipe)
    id: number,
    @Body()
    body: UpdateOrderStatusRequest,
  ) {
    return this.ordersService.updateStatus(id, body.status);
  }

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
    await this.ordersService.findById(id);

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
