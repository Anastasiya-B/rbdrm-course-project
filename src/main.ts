import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { getAuthConfig } from './auth/auth.config';
import type { Env } from './config/env.schema';
import {
  markNotReady,
  markReady,
  sleep,
} from './lifecycle';

const STARTUP_DELAY_MS = 4_000;
const DRAIN_DELAY_MS = 5_000;

async function bootstrap() {
  getAuthConfig();

  const app =
    await NestFactory.create(AppModule);

  const configService =
    app.get<ConfigService<Env, true>>(
      ConfigService,
    );

  const port =
    configService.get('PORT', {
      infer: true,
    });

  let shuttingDown = false;

  const shutdown = async (
    signal: string,
  ) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    console.log(
      `${signal}: marking pod not ready`,
    );

    markNotReady();

    console.log(
      `Draining for ${DRAIN_DELAY_MS}ms`,
    );

    await sleep(
      DRAIN_DELAY_MS,
    );

    console.log(
      'Closing HTTP server',
    );

    await app.close();

    process.exit(0);
  };

  process.on(
    'SIGTERM',
    () => {
      void shutdown(
        'SIGTERM',
      );
    },
  );

  process.on(
    'SIGINT',
    () => {
      void shutdown(
        'SIGINT',
      );
    },
  );

  /*
   * Intentional warm-up used by the HW28 rollout demo.
   *
   * This represents real-world startup work such as
   * migrations, connection-pool creation or cache warm-up.
   */
  await sleep(
    STARTUP_DELAY_MS,
  );

  await app.listen(
    port,
    '0.0.0.0',
  );

  markReady();

  console.log(
    `Marketplace API is running on http://0.0.0.0:${port}`,
  );
}

void bootstrap();