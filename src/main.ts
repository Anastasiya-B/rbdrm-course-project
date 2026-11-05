import 'reflect-metadata';
import { getAuthConfig } from './auth/auth.config';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap() {
  getAuthConfig();
  const app = await NestFactory.create(AppModule);

  const configService = app.get<ConfigService<Env, true>>(ConfigService);

  const port = configService.get('PORT', { infer: true });

  await app.listen(process.env.PORT ?? 3000);

  console.log(`Marketplace API is running on http://localhost:${port}`);
}

bootstrap();
