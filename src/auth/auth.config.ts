import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';

export interface AuthConfig {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  refreshTokenPepper: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function decodePem(name: string): string {
  const encoded = requireEnv(name);

  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw new Error(`${name} must be base64 encoded`);
  }
}

let cachedConfig: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const kid = requireEnv('JWT_KID');

  const privateKeyPem = decodePem('JWT_PRIVATE_KEY');

  const publicKeyPem = decodePem('JWT_PUBLIC_KEY');

  const refreshTokenPepper = requireEnv('REFRESH_TOKEN_PEPPER');

  let privateKey: KeyObject;
  let publicKey: KeyObject;

  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error('JWT_PRIVATE_KEY is invalid');
  }

  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error('JWT_PUBLIC_KEY is invalid');
  }

  cachedConfig = {
    kid,
    privateKey,
    publicKey,
    refreshTokenPepper,
    accessTokenTtlSeconds: 10 * 60,
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  };

  return cachedConfig;
}
