import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

@Injectable()
export class XmlService {
  private readonly parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      textNodeName: 'text',
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      removeNSPrefix: false,
    });
  }

  parse(xml: string): any {
    return this.parser.parse(xml);
  }
}
