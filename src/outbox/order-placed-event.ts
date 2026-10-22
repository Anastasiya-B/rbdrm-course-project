export const ORDER_PLACED_TYPE = 'order.placed' as const;

export interface OrderPlacedPayload {
  eventId: string;
  type: typeof ORDER_PLACED_TYPE;
  occurredAt: string;
  data: {
    orderId: number;
    userId: number;
    items: Array<{
      productId: number;
      quantity: number;
    }>;
    totalAmount: number;
  };
}

interface ToOrderPlacedEventInput {
  eventId: string;
  orderId: number;
  userId: number;
  items: Array<{
    product_id: number;
    quantity: number;
  }>;
  totalAmount: number;
}

export function toOrderPlacedEvent(
  input: ToOrderPlacedEventInput,
): OrderPlacedPayload {
  return {
    eventId: input.eventId,
    type: ORDER_PLACED_TYPE,
    occurredAt: new Date().toISOString(),
    data: {
      orderId: input.orderId,
      userId: input.userId,
      items: input.items.map(item => ({
        productId: item.product_id,
        quantity: item.quantity,
      })),
      totalAmount: input.totalAmount,
    },
  };
}
