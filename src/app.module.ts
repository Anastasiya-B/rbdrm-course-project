import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.schema';
import { DatabaseService } from './database.service';
import { FilesModule } from './files/files.module';
import { MetricsController } from './observability/metrics.controller';
import { MetricsInterceptor } from './observability/metrics.interceptor';
import { ObservabilityController } from './observability/observability.controller';
import { ObservabilityService } from './observability/observability.service';
import { ObservabilityOrdersRepository } from './observability/orders.repository';
import { RequestContextMiddleware } from './observability/request-context.middleware';
import { OrderEventsService } from './orders/order-events.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersGateway } from './orders/orders.gateway';
import { OrdersService } from './orders/orders.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,

      envFilePath: '.env',

      validate: validateEnv,
    }),

    AuthModule,
    FilesModule,
  ],

  controllers: [
    AppController,
    OrdersController,
    MetricsController,
    ObservabilityController,
  ],

  providers: [
    DatabaseService,
    OrderEventsService,
    OrdersService,
    OrdersGateway,

    ObservabilityOrdersRepository,
    ObservabilityService,

    {
      provide: APP_INTERCEPTOR,

      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
