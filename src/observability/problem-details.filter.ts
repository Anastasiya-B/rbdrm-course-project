import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const detail = typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'message' in raw
        ? Array.isArray(raw.message) ? raw.message.join('; ') : String(raw.message)
        : status >= 500 ? 'Internal server error' : 'Request failed';
    const title = status >= 500
      ? 'Internal Server Error'
      : HttpStatus[status]
        ? HttpStatus[status].replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase())
        : 'Request Error';

    response.status(status).type('application/problem+json').json({
      type: `https://marketplace.example/problems/${status}`,
      title,
      status,
      detail,
      instance: request.originalUrl,
    });
  }
}
