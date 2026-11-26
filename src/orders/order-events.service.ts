import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import Redis from 'ioredis';

import type { OrderStatus } from '../entities/order.entity';

export interface OrderStatusEvent {
  id: number;
  orderId: number;
  status: OrderStatus;
  occurredAt: string;
}

const MAX_BUFFERED_EVENTS_PER_ORDER = 100;

@Injectable()
export class OrderEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly subject = new Subject<OrderStatusEvent>();
  private readonly buffers = new Map<number, OrderStatusEvent[]>();
  private readonly seenEvents = new Set<string>();
  private nextEventId = 1;
  private publisher?: Redis;
  private subscriber?: Redis;
  private readonly channel = 'marketplace:order-status';

  readonly events$ = this.subject.asObservable();

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) return;
    this.publisher = new Redis(url, { maxRetriesPerRequest: 2 });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: 2 });
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on('message', (channel, message) => {
      if (channel !== this.channel) return;
      try {
        this.recordEvent(JSON.parse(message) as OrderStatusEvent);
      } catch {
        // Ignore malformed cross-process notifications.
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher?.quit();
    await this.subscriber?.quit();
  }

  emitStatusChanged(orderId: number, status: OrderStatus): OrderStatusEvent {
    const event: OrderStatusEvent = {
      id: this.nextEventId,
      orderId,
      status,
      occurredAt: new Date().toISOString(),
    };

    this.nextEventId += 1;

    this.recordEvent(event);
    void this.publisher?.publish(this.channel, JSON.stringify(event));

    return event;
  }

  private recordEvent(event: OrderStatusEvent): void {
    const eventKey = `${event.orderId}:${event.id}:${event.occurredAt}`;

    if (this.seenEvents.has(eventKey)) {
      return;
    }

    this.seenEvents.add(eventKey);

    if (this.seenEvents.size > MAX_BUFFERED_EVENTS_PER_ORDER * 10) {
      const oldest = this.seenEvents.values().next().value;
      if (oldest) this.seenEvents.delete(oldest);
    }

    const buffer = this.buffers.get(event.orderId) ?? [];

    buffer.push(event);

    if (buffer.length > MAX_BUFFERED_EVENTS_PER_ORDER) {
      buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS_PER_ORDER);
    }

    this.buffers.set(event.orderId, buffer);
    this.subject.next(event);
  }

  getEventsAfter(orderId: number, lastEventId: number): OrderStatusEvent[] {
    const buffer = this.buffers.get(orderId) ?? [];

    return buffer.filter(event => event.id > lastEventId);
  }
}
