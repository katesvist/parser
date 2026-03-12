import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerAnalyticsModule } from './worker-analytics.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerAnalyticsModule, {
    logger: ['log', 'warn', 'error'],
  });
}

bootstrap();
