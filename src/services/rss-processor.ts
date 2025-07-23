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
          ['enclosure', 'enclosure'],
          ['itunes:duration', 'duration'],
          ['itunes:episode', 'episodeNumber'],
          ['itunes:episodeType', 'episodeType'],
          ['itunes:explicit', 'explicit'],
          ['itunes:image', 'itunesImage'],
        ],
        feed: [
          ['itunes:author', 'itunesAuthor'],
          ['itunes:category', 'itunesCategory'],
          ['itunes:explicit', 'itunesExplicit'],
          ['itunes:image', 'itunesImage'],
        ],
      },
    });
    this.database = database;
  }

  async processRssFeed(rssUrl: string): Promise<void> {
    try {
      const feed = await this.parser.parseURL(rssUrl);
      
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
    } catch (error) {
      logger.error(`Error processing RSS feed ${rssUrl}: ${error}`);
      throw error;
    }
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
