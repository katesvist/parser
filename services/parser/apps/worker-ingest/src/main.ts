import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerIngestModule } from './worker-ingest.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerIngestModule, {
    logger: ['log', 'warn', 'error'],
  });
}

bootstrap();
