import { Controller, Get } from '@nestjs/common';

import { DatabaseService } from './database.service';

const startedAt = Date.now();

@Controller()
export class AppController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  getRoot() {
    return {
      message: 'Marketplace API',
    };
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    };
  }

  @Get('db-check')
  async getDatabaseCheck() {
    const result = await this.databaseService.checkConnection();

    return {
      status: 'ok',
      database: result.message,
    };
  }
}
