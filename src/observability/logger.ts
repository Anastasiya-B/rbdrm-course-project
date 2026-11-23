import { trace } from '@opentelemetry/api';
import pino from 'pino';

import { getRequestContext } from './context';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',

  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'authorization',
      'password',
      'body.password',
      'req.body.password',
      'credentials.password',
    ],

    censor: '[REDACTED]',
  },

  mixin() {
    const span = trace.getActiveSpan();

    const traceId = span?.spanContext().traceId;

    const context = getRequestContext();

    return {
      ...(traceId
        ? {
            trace_id: traceId,
          }
        : {}),

      ...(context?.userId
        ? {
            userId: context.userId,
          }
        : {}),

      ...(context?.tenant
        ? {
            tenant: context.tenant,
          }
        : {}),

      ...(context?.idempotencyKey
        ? {
            idempotencyKey: context.idempotencyKey,
          }
        : {}),
    };
  },
});

export function createLogger(layer: string) {
  return logger.child({
    layer,
  });
}
