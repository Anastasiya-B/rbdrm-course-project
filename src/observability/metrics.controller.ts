import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { metricsRegistry } from './metrics';

@Controller()
export class MetricsController {
  @Get('metrics')
  async metrics(
    @Res()
    response: Response,
  ): Promise<void> {
    response.setHeader('Content-Type', metricsRegistry.contentType);

    response.send(await metricsRegistry.metrics());
  }
}
