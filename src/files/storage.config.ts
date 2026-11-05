export interface StorageConfig {
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function getStorageConfig(): StorageConfig {
  const endpoint = process.env.STORAGE_ENDPOINT || undefined;

  return {
    endpoint,
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    accessKeyId: requireEnv('STORAGE_ACCESS_KEY'),
    secretAccessKey: requireEnv('STORAGE_SECRET_KEY'),
    bucket: requireEnv('STORAGE_BUCKET'),
  };
}
