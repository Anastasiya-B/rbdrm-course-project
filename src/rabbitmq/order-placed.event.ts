export const ORDER_PLACED_EVENT_TYPE = 'order.placed' as const;

export interface OrderPlacedEvent {
  eventId: string;
  type: typeof ORDER_PLACED_EVENT_TYPE;
  occurredAt: string;
  data: {
    orderId: string;
    userId: string;
    productId: string;
    quantity: number;
    totalAmount: number;
  };
}
