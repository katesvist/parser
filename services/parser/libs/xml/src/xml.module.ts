import { Global, Module } from '@nestjs/common';
import { XmlService } from './xml.service';

@Global()
@Module({
  providers: [XmlService],
  exports: [XmlService],
})
export class XmlModule {}
