import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../../../libs/db/src';
import { HttpModule } from '../../../libs/http/src';
import { DocsTask } from './docs.task';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    HttpModule,
  ],
  providers: [DocsTask],
})
export class WorkerDocsModule {}
