import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext } from './context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const userId = request.header('x-user-id') ?? undefined;

    const tenant = request.header('x-tenant') ?? undefined;

    const idempotencyKey = request.header('idempotency-key') ?? undefined;

    runWithRequestContext(
      {
        userId,
        tenant,
        idempotencyKey,
      },
      next,
    );
  }
}
