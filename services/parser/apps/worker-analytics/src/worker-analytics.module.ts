import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '../../../libs/db/src';
import { HttpModule } from '../../../libs/http/src';
import { XmlModule } from '../../../libs/xml/src';
import { AnalyticsTask } from './analytics.task';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    HttpModule,
    XmlModule,
  ],
  providers: [AnalyticsTask],
})
export class WorkerAnalyticsModule {}
