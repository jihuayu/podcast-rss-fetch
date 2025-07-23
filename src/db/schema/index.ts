import { pgTable, uuid, varchar, text, boolean, timestamp, integer, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const podcasts = pgTable('podcasts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  link: text('link'),
  language: varchar('language', { length: 50 }),
  copyright: text('copyright'),
  author: varchar('author', { length: 255 }),
  email: varchar('email', { length: 255 }),
  imageUrl: text('image_url'),
  category: varchar('category', { length: 255 }),
  explicit: boolean('explicit').default(false),
  rssUrl: text('rss_url').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const episodes = pgTable('episodes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  podcastId: uuid('podcast_id').notNull().references(() => podcasts.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  link: text('link'),
  enclosureUrl: text('enclosure_url'),
  enclosureType: varchar('enclosure_type', { length: 100 }),
  enclosureLength: bigint('enclosure_length', { mode: 'number' }),
  guid: text('guid').notNull().unique(),
  pubDate: timestamp('pub_date'),
  duration: varchar('duration', { length: 50 }),
  episodeNumber: integer('episode_number'),
  episodeType: varchar('episode_type', { length: 50 }),
  imageUrl: text('image_url'),
  explicit: boolean('explicit').default(false),
  downloadSuccess: boolean('download_success').default(false),
  downloadedAt: timestamp('downloaded_at'),
  minioPath: text('minio_path'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type Podcast = typeof podcasts.$inferSelect;
export type NewPodcast = typeof podcasts.$inferInsert;

export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;
