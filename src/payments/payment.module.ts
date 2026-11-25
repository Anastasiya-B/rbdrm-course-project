import { Module } from '@nestjs/common';

import { DatabaseService } from '../database.service';
import { OrderEventsService } from '../orders/order-events.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

@Module({
  controllers: [PaymentController],
  providers: [DatabaseService, OrderEventsService, PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
