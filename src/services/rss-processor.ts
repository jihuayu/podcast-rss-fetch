import Parser from 'rss-parser';
import { Database } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { logger } from '../utils/logger.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export class RssProcessor {
  private parser: Parser;
  private database: Database;

  constructor(database: Database) {
    this.parser = new Parser({
      customFields: {
        item: [
          'enclosure',
          'itunes:duration',
          'itunes:episode',
          'itunes:episodeType',
          'itunes:explicit',
          'itunes:image',
        ],
        feed: [
          'itunes:author',
          'itunes:category',
          'itunes:explicit',
          'itunes:image',
        ],
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000,
    });
    this.database = database;
  }

  async processRssFeed(rssUrl: string): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Processing RSS feed (attempt ${attempt}/${maxRetries}): ${rssUrl}`);
        
        // First, fetch and validate the content
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(rssUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        
        // Log the first 200 characters for debugging
        logger.debug(`Content type: ${contentType}, First 200 chars: ${text.substring(0, 200)}`);
        
        // Check if content looks like XML/RSS
        const trimmedText = text.trim();
        if (!trimmedText.startsWith('<?xml') && !trimmedText.startsWith('<rss') && !trimmedText.startsWith('<feed')) {
          throw new Error(`Invalid RSS content. Content type: ${contentType}. Content starts with: ${trimmedText.substring(0, 100)}`);
        }
        
        // Clean and validate the XML content
        const cleanedXml = this.cleanXmlContent(text);
        
        // Parse the validated content
        const feed = await this.parser.parseString(cleanedXml);
        
        // Insert or update podcast
        const podcast = await this.insertOrUpdatePodcast(feed, rssUrl);
        
        // Process episodes
        for (const item of feed.items || []) {
          try {
            await this.insertEpisodeIfNotExists(podcast.id, item);
          } catch (error) {
            const title = item.title || 'Unknown';
            logger.warn(`Error inserting episode ${title}: ${error}`);
          }
        }
        
        logger.info(`Successfully processed RSS feed: ${rssUrl}`);
        return; // Success, exit the retry loop
        
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Attempt ${attempt}/${maxRetries} failed for RSS feed ${rssUrl}: ${error}`);
        
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          logger.info(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // All retries failed
    logger.error(`Error processing RSS feed ${rssUrl} after ${maxRetries} attempts: ${lastError}`);
    throw lastError;
  }

  private cleanXmlContent(content: string): string {
    // Remove any content before the XML declaration or root element
    let cleaned = content.trim();
    
    // Find the start of XML content
    const xmlStart = cleaned.search(/<\?xml|<rss|<feed/i);
    if (xmlStart > 0) {
      logger.warn(`Removing ${xmlStart} characters before XML content`);
      cleaned = cleaned.substring(xmlStart);
    }
    
    // Remove any BOM (Byte Order Mark)
    if (cleaned.charCodeAt(0) === 0xFEFF) {
      cleaned = cleaned.substring(1);
    }
    
    return cleaned;
  }

  private async insertOrUpdatePodcast(feed: any, rssUrl: string): Promise<schema.Podcast> {
    const defaultTenantId = '00000000-0000-0000-0000-000000000001';

    // Check if podcast already exists
    const existingPodcast = await this.database.db
      .select()
      .from(schema.podcasts)
      .where(eq(schema.podcasts.rssUrl, rssUrl))
      .limit(1);

    const podcastData = {
      tenantId: defaultTenantId,
      title: feed.title || 'Unknown',
      description: feed.description || null,
      link: feed.link || null,
      language: feed.language || null,
      copyright: feed.copyright || null,
      author: feed.itunesAuthor || feed.creator || null,
      email: feed.managingEditor || null,
      imageUrl: feed.image?.url || feed.itunesImage?.href || null,
      category: feed.itunesCategory?.text || null,
      explicit: feed.itunesExplicit === 'yes' || false,
      rssUrl,
      updatedAt: new Date(),
    };

    if (existingPodcast.length > 0) {
      // Update existing podcast
      const [updatedPodcast] = await this.database.db
        .update(schema.podcasts)
        .set(podcastData)
        .where(eq(schema.podcasts.id, existingPodcast[0].id))
        .returning();
      
      logger.info(`Updated existing podcast: ${updatedPodcast.title}`);
      return updatedPodcast;
    } else {
      // Insert new podcast
      const [insertedPodcast] = await this.database.db
        .insert(schema.podcasts)
        .values({
          id: uuidv4(),
          ...podcastData,
          createdAt: new Date(),
        })
        .returning();
      
      logger.info(`Inserted new podcast: ${insertedPodcast.title}`);
      return insertedPodcast;
    }
  }

  private async insertEpisodeIfNotExists(podcastId: string, item: any): Promise<void> {
    // Generate GUID
    const guid = item.guid || item.link || `${podcastId}_${item.title || ''}`;

    // Check if episode already exists
    const existingEpisode = await this.database.db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.guid, guid))
      .limit(1);

    if (existingEpisode.length > 0) {
      return; // Already exists, skip
    }

    // Process enclosure (media file)
    let enclosureUrl: string | null = null;
    let enclosureType: string | null = null;
    let enclosureLength: number | null = null;

    if (item.enclosure) {
      enclosureUrl = item.enclosure.url || null;
      enclosureType = item.enclosure.type || null;
      enclosureLength = item.enclosure.length ? parseInt(item.enclosure.length) : null;
    }

    const episodeData: schema.NewEpisode = {
      id: uuidv4(),
      podcastId,
      title: item.title || 'Unknown',
      description: item.contentSnippet || item.content || null,
      link: item.link || null,
      enclosureUrl,
      enclosureType,
      enclosureLength,
      guid,
      pubDate: item.pubDate ? new Date(item.pubDate) : null,
      duration: item.duration || null,
      episodeNumber: item.episodeNumber ? parseInt(item.episodeNumber) : null,
      episodeType: item.episodeType || null,
      imageUrl: item.itunesImage?.href || null,
      explicit: item.explicit === 'yes' || false,
      downloadSuccess: false,
      downloadedAt: null,
      minioPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const [insertedEpisode] = await this.database.db
      .insert(schema.episodes)
      .values(episodeData)
      .returning();

    logger.info(`Inserted new episode: ${insertedEpisode.title}`);
  }
}
