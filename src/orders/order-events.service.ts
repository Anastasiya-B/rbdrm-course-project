import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

import type { OrderStatus } from '../entities/order.entity';

export interface OrderStatusEvent {
  id: number;
  orderId: number;
  status: OrderStatus;
  occurredAt: string;
}

const MAX_BUFFERED_EVENTS_PER_ORDER = 100;

@Injectable()
export class OrderEventsService {
  private readonly subject = new Subject<OrderStatusEvent>();
  private readonly buffers = new Map<number, OrderStatusEvent[]>();
  private nextEventId = 1;

  readonly events$ = this.subject.asObservable();

  emitStatusChanged(orderId: number, status: OrderStatus): OrderStatusEvent {
    const event: OrderStatusEvent = {
      id: this.nextEventId,
      orderId,
      status,
      occurredAt: new Date().toISOString(),
    };

    this.nextEventId += 1;

    const buffer = this.buffers.get(orderId) ?? [];

    buffer.push(event);

    if (buffer.length > MAX_BUFFERED_EVENTS_PER_ORDER) {
      buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS_PER_ORDER);
    }

    this.buffers.set(orderId, buffer);
    this.subject.next(event);

    return event;
  }

  getEventsAfter(orderId: number, lastEventId: number): OrderStatusEvent[] {
    const buffer = this.buffers.get(orderId) ?? [];

    return buffer.filter(event => event.id > lastEventId);
  }
}
