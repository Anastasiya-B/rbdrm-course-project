import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { Request } from 'express';

import { verifyAccessToken, type AccessTokenPayload } from './auth.tokens';

import { isAccessTokenDenied } from './access-denylist';

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const header = request.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Access token is required');
    }

    const token = header.slice('Bearer '.length);

    let payload: AccessTokenPayload;

    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    if (await isAccessTokenDenied(payload.jti)) {
      throw new UnauthorizedException('Access token revoked');
    }

    request.user = payload;

    return true;
  }
}
