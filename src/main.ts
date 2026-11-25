import './observability/telemetry';

import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { getAuthConfig } from './auth/auth.config';
import type { Env } from './config/env.schema';
import { markNotReady, markReady, sleep } from './lifecycle';
import { shutdownTelemetry } from './observability/telemetry';
import { ProblemDetailsFilter } from './observability/problem-details.filter';

const STARTUP_DELAY_MS = 4_000;

const DRAIN_DELAY_MS = 5_000;

async function bootstrap() {
  getAuthConfig();

  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalFilters(new ProblemDetailsFilter());

  const configService = app.get<ConfigService<Env, true>>(ConfigService);

  const port = configService.get('PORT', {
    infer: true,
  });

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    console.log(`${signal}: marking pod not ready`);

    markNotReady();

    console.log(`Draining for ${DRAIN_DELAY_MS}ms`);

    await sleep(DRAIN_DELAY_MS);

    console.log('Closing HTTP server');

    await app.close();

    await shutdownTelemetry();

    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await sleep(STARTUP_DELAY_MS);

  await app.listen(port, '0.0.0.0');

  markReady();

  console.log(`Marketplace API is running on http://0.0.0.0:${port}`);
}

void bootstrap();
