import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerDocsModule } from './worker-docs.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerDocsModule, {
    logger: ['log', 'warn', 'error'],
  });
}

bootstrap();
