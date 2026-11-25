import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PaymentService } from './payment.service';

interface PaymentWebhookRequest extends Request {
  rawBody?: Buffer;
}

interface PaymentWebhookBody {
  event_id: string;
  order_id: number;
  amount: number;
}

@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-payment-signature') signature: string | undefined,
    @Req() request: PaymentWebhookRequest,
    @Body() body: PaymentWebhookBody,
  ) {
    const rawBody = request.rawBody?.toString('utf8');
    if (!rawBody || !signature || !this.paymentService.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid payment webhook signature');
    }
    if (!body.event_id || !Number.isInteger(body.order_id) || !Number.isSafeInteger(body.amount)) {
      throw new BadRequestException('Invalid payment webhook');
    }

    const result = await this.paymentService.finalizePayment({
      orderId: body.order_id,
      amount: body.amount,
      providerEventId: body.event_id,
      providerPayload: rawBody,
    });
    return { status: result === 'duplicate' ? 'duplicate' : 'paid' };
  }
}
