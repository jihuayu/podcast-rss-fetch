#!/usr/bin/env node

import { Command } from 'commander';
import { Database } from './db/index.js';
import { RssProcessor } from './services/rss-processor.js';
import { Downloader } from './services/downloader.js';
import { OpmlParser } from './services/opml-parser.js';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';
import { promises as fs } from 'fs';

const program = new Command();

program
  .name('podcast-rss-fetch')
  .description('TypeScript version of podcast RSS fetcher with Drizzle ORM')
  .version('1.0.0');

program
  .option('-d, --download', '下载所有未下载的节目到MinIO')
  .parse();

const options = program.opts();

async function main(): Promise<void> {
  try {
    logger.info(`Connected to database: ${config.database.host}:${config.database.port}/${config.database.name}`);

    // Connect to database
    const database = new Database();
    await database.connect();
    logger.info('Connected to database successfully');

    if (options.download) {
      // Download mode
      logger.info('Starting download mode...');
      const downloader = new Downloader(database);
      await downloader.initialize();
      await downloader.downloadAllUndownloadedEpisodes();
      logger.info('Download completed!');
      return;
    }

    // Default RSS fetch mode
    logger.info('Starting RSS fetch mode...');

    // Collect RSS URLs from all sources
    const rssUrls = await collectRssUrlsFromAllSources();
    logger.info(`Total RSS URLs collected: ${rssUrls.length}`);

    // Process each RSS URL
    const rssProcessor = new RssProcessor(database);
    for (const rssUrl of rssUrls) {
      logger.info(`Processing RSS: ${rssUrl}`);
      try {
        await rssProcessor.processRssFeed(rssUrl);
        logger.info(`Successfully processed RSS: ${rssUrl}`);
      } catch (error) {
        logger.warn(`Error processing RSS ${rssUrl}: ${error}`);
      }
    }

    logger.info('All RSS feeds processed successfully!');
  } catch (error) {
    logger.error('Application error:', error);
    process.exit(1);
  }
}

async function collectRssUrlsFromAllSources(): Promise<string[]> {
  const allRssUrls: string[] = [];
  const urlSet = new Set<string>();

  // 1. Read from fedd.txt file
  try {
    const txtUrls = await readRssUrlsFromFile('feed.txt');
    logger.info(`Found ${txtUrls.length} URLs from feed.txt`);
    for (const url of txtUrls) {
      if (!urlSet.has(url)) {
        urlSet.add(url);
        allRssUrls.push(url);
      }
    }
  } catch (error) {
    logger.warn('Warning: Could not read feed.txt');
  }

  // 2. Read from feed.xml file (as OPML file)
  const opmlParser = new OpmlParser();
  try {
    const opmlUrls = await opmlParser.parseOpmlFile('feed.xml');
    logger.info(`Found ${opmlUrls.length} URLs from feed.xml`);
    for (const url of opmlUrls) {
      if (!urlSet.has(url)) {
        urlSet.add(url);
        allRssUrls.push(url);
      }
    }
  } catch (error) {
    logger.warn('Warning: Could not parse feed.xml as OPML');
  }

  // 3. Read from other possible OPML files
  const opmlFiles = ['feed.opml', 'podcasts.opml', 'subscriptions.opml'];
  for (const filename of opmlFiles) {
    try {
      const opmlUrls = await opmlParser.parseOpmlFile(filename);
      logger.info(`Found ${opmlUrls.length} URLs from ${filename}`);
      for (const url of opmlUrls) {
        if (!urlSet.has(url)) {
          urlSet.add(url);
          allRssUrls.push(url);
        }
      }
    } catch (error) {
      // Silently continue for optional files
    }
  }

  if (allRssUrls.length === 0) {
    throw new Error('No RSS URLs found in any data source');
  }

  return allRssUrls;
}

async function readRssUrlsFromFile(filename: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filename, 'utf-8');
    const lines = content.split('\n');
    const urls: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        urls.push(trimmedLine);
        logger.info(`Found RSS URL from text file: ${trimmedLine}`);
      }
    }

    return urls;
  } catch (error) {
    throw new Error(`Could not read file ${filename}: ${error}`);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the main function
main().catch((error) => {
  logger.error('Main function error:', error);
  process.exit(1);
});
