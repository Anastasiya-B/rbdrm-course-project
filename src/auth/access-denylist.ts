import AppDataSource from '../data-source';

async function ensureDataSource(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

export async function isAccessTokenDenied(jti: string): Promise<boolean> {
  await ensureDataSource();

  const rows = (await AppDataSource.query(
    `
        SELECT 1
        FROM access_token_denylist
        WHERE jti = $1
          AND expires_at > now()
        LIMIT 1
      `,
    [jti],
  )) as Array<{
    '?column?': number;
  }>;

  return rows.length > 0;
}
