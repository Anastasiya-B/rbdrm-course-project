import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  DB_URL: z.string().min(1, 'DB_URL is required'),

  DB_PASSWORD_FILE: z
    .string()
    .min(1, 'DB_PASSWORD_FILE is required')
    .default('secrets/db_password'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map(issue => {
      const field = issue.path.join('.');
      return `${field}: ${issue.message}`;
    });

    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  return result.data;
}
