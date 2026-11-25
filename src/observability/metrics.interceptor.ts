import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

import { httpRequestDurationSeconds, httpRequestsTotal } from './metrics';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();

    const request = http.getRequest<Request>();

    const response = http.getResponse<Response>();

    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const finishedAt = process.hrtime.bigint();

      const durationSeconds = Number(finishedAt - startedAt) / 1_000_000_000;

      const route = request.route?.path ?? 'unknown';

      const labels = {
        method: request.method,

        route: String(route),

        status: String(response.statusCode),
      };

      httpRequestsTotal.labels(labels).inc();

      httpRequestDurationSeconds.labels(labels).observe(durationSeconds);
    });

    return next.handle();
  }
}
