export interface OrderPlacedMessage {
  eventId: string;
  type: 'order.placed';
  occurredAt: string;
  data: {
    orderId: string | number;
  };
}
