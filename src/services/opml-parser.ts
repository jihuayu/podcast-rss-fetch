import { XMLParser } from 'fast-xml-parser';
import { promises as fs } from 'fs';
import { logger } from '../utils/logger.js';

interface OpmlOutline {
  '@_xmlUrl'?: string;
  outline?: OpmlOutline | OpmlOutline[];
}

interface OpmlBody {
  outline?: OpmlOutline | OpmlOutline[];
}

interface OpmlData {
  opml?: {
    body?: OpmlBody;
  };
}

export class OpmlParser {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true,
      attributeNamePrefix: '@_',
    });
  }

  async parseOpmlFile(filename: string): Promise<string[]> {
    try {
      // Check if file exists
      await fs.access(filename);
      
      const content = await fs.readFile(filename, 'utf-8');
      const opmlData: OpmlData = this.xmlParser.parse(content);
      
      const rssUrls: string[] = [];
      
      if (opmlData.opml?.body?.outline) {
        this.extractUrlsFromOutlines(opmlData.opml.body.outline, rssUrls);
      }
      
      return rssUrls;
    } catch (error) {
      logger.info(`OPML file ${filename} does not exist or cannot be parsed, skipping`);
      return [];
    }
  }

  private extractUrlsFromOutlines(outlines: OpmlOutline | OpmlOutline[], rssUrls: string[]): void {
    const outlinesArray = Array.isArray(outlines) ? outlines : [outlines];
    
    for (const outline of outlinesArray) {
      if (outline['@_xmlUrl']) {
        const xmlUrl = outline['@_xmlUrl'];
        if (xmlUrl && xmlUrl.trim() !== '') {
          rssUrls.push(xmlUrl);
          logger.info(`Found RSS URL from OPML: ${xmlUrl}`);
        }
      }
      
      // Recursively process nested outlines
      if (outline.outline) {
        this.extractUrlsFromOutlines(outline.outline, rssUrls);
      }
    }
  }
}
