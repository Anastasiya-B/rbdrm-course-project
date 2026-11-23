import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { createLogger } from './logger';
import { ObservabilityService } from './observability.service';

interface DemoBody {
  password?: string;
}

@Controller('observability/orders')
export class ObservabilityController {
  private readonly logger = createLogger('orders.controller');

  constructor(private readonly service: ObservabilityService) {}

  @Get(':id')
  async getOrder(
    @Param('id', ParseIntPipe)
    id: number,

    @Query('fail')
    fail: string | undefined,
  ) {
    this.logger.info(
      {
        orderId: id,
      },
      'controller lookup',
    );

    return this.service.findOrder(id, fail === '1');
  }

  @Post(':id/log-demo')
  async logDemo(
    @Param('id', ParseIntPipe)
    id: number,

    @Body()
    body: DemoBody,

    @Req()
    request: Request,
  ) {
    /*
     * The request itself is present in
     * the structured log, while the
     * secret values are removed by
     * pino redact.
     */
    this.logger.info(
      {
        req: {
          headers: {
            authorization: request.header('authorization'),
          },

          body: {
            password: body.password,
          },
        },

        orderId: id,
      },
      'observability demo request',
    );

    return this.service.findOrder(id, false);
  }
}
