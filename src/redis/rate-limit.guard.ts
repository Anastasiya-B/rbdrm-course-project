import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { RedisRateLimiter } from './rate-limit';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private limiter?: RedisRateLimiter;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!process.env.REDIS_QUEUE_URL) return true;
    this.limiter ??= new RedisRateLimiter('api', Number(process.env.RATE_LIMIT_MAX ?? 100));
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const clientId = request.ip || request.socket.remoteAddress || 'unknown';
    const result = await this.limiter.check(clientId);
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
