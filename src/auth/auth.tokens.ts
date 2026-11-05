import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { sign, verify, type JwtPayload } from 'jsonwebtoken';

import { getAuthConfig } from './auth.config';

export type UserRole = 'buyer' | 'seller' | 'admin';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: UserRole;
  jti: string;
  familyId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessJti: string;
  familyId: string;
}

export function createRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(refreshToken: string): string {
  const { refreshTokenPepper } = getAuthConfig();

  return createHmac('sha256', refreshTokenPepper)
    .update(refreshToken)
    .digest('hex');
}

export function signAccessToken(
  userId: number,
  role: UserRole,
  familyId: string,
): {
  token: string;
  jti: string;
} {
  const config = getAuthConfig();

  const jti = randomUUID();

  const token = sign(
    {
      role,
      familyId,
    },
    config.privateKey,
    {
      algorithm: 'RS256',
      keyid: config.kid,
      subject: String(userId),
      jwtid: jti,
      expiresIn: config.accessTokenTtlSeconds,
    },
  );

  return {
    token,
    jti,
  };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const config = getAuthConfig();

  const decoded = verify(token, config.publicKey, {
    algorithms: ['RS256'],
  });

  if (typeof decoded === 'string') {
    throw new Error('Invalid access token payload');
  }

  if (
    !decoded.sub ||
    !decoded.jti ||
    typeof decoded.role !== 'string' ||
    typeof decoded.familyId !== 'string'
  ) {
    throw new Error('Invalid access token claims');
  }

  if (!['buyer', 'seller', 'admin'].includes(decoded.role)) {
    throw new Error('Invalid role');
  }

  return decoded as AccessTokenPayload;
}
