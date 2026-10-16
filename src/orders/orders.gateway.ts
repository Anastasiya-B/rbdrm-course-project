import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { Subscription } from 'rxjs';

import { OrderEventsService } from './order-events.service';
import { OrdersService } from './orders.service';

interface JoinOrderPayload {
  orderId: number;
}

interface JoinOrderResponse {
  ok: boolean;
  room?: string;
  error?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private eventsSubscription?: Subscription;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  afterInit(): void {
    this.eventsSubscription = this.orderEventsService.events$.subscribe(
      event => {
        this.server.to(this.getRoomName(event.orderId)).emit('order.status', {
          id: event.id,
          orderId: event.orderId,
          status: event.status,
          occurredAt: event.occurredAt,
        });
      },
    );
  }

  onModuleDestroy(): void {
    this.eventsSubscription?.unsubscribe();
  }

  @SubscribeMessage('join')
  async joinOrderRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinOrderPayload,
  ): Promise<JoinOrderResponse> {
    const orderId = Number(payload?.orderId);
    const userId = Number(client.handshake.auth?.userId);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return {
        ok: false,
        error: 'Invalid order id',
      };
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return {
        ok: false,
        error: 'Unauthorized',
      };
    }

    const ownsOrder = await this.ordersService.belongsToUser(orderId, userId);

    if (!ownsOrder) {
      return {
        ok: false,
        error: 'Order does not belong to this user',
      };
    }

    const room = this.getRoomName(orderId);

    await client.join(room);

    return {
      ok: true,
      room,
    };
  }

  private getRoomName(orderId: number): string {
    return `orders:${orderId}`;
  }
}
