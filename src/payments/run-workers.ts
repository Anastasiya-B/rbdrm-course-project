import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PaymentService } from './payment.service';
import { startOrderPlacedConsumer } from '../rabbitmq/order-placed.consumer';

async function main(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule);
  const paymentService = context.get(PaymentService);
  const consumer = await startOrderPlacedConsumer(undefined, paymentService);

  const shutdown = async () => {
    await consumer.close();
    await context.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void main().catch(error => {
  console.error('Payment worker failed:', error);
  process.exit(1);
});
