import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Database } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { eq, and } from 'drizzle-orm';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export class Downloader {
  private database: Database;
  private httpClient: any;
  private s3Client: S3Client;
  private bucketName: string;

  constructor(database: Database) {
    this.database = database;
    this.bucketName = config.minio.bucket;
    
    // Configure HTTP client (using fetch API)
    this.httpClient = {
      timeout: 300000, // 5 minutes
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    // Configure S3 client for MinIO
    this.s3Client = new S3Client({
      endpoint: `http${config.minio.useSSL ? 's' : ''}://${config.minio.endpoint}`,
      region: 'us-east-1', // MinIO doesn't require specific region
      credentials: {
        accessKeyId: config.minio.accessKey,
        secretAccessKey: config.minio.secretKey,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async initialize(): Promise<void> {
    logger.info(`Trying to connect to MinIO at: ${config.minio.endpoint}`);
    await this.createBucketIfNotExists();
    logger.info(`MinIO client initialized with bucket: ${this.bucketName}`);
  }

  private async createBucketIfNotExists(): Promise<void> {
    try {
      // Check if bucket exists
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      logger.info(`Bucket ${this.bucketName} already exists`);
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        // Create bucket
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
        logger.info(`Created bucket: ${this.bucketName}`);
      } else {
        throw error;
      }
    }
  }

  async downloadAllUndownloadedEpisodes(): Promise<void> {
    const episodes = await this.getUndownloadedEpisodes();
    logger.info(`Found ${episodes.length} undownloaded episodes`);

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      logger.info(`Processing episode ${i + 1}/${episodes.length}: ${episode.title}`);

      try {
        await this.downloadAndUploadEpisode(episode);
        successCount++;
        logger.info(`Successfully processed episode: ${episode.title}`);
      } catch (error) {
        failureCount++;
        logger.error(`Error processing episode ${episode.title}: ${error}`);

        // Mark as failed
        try {
          await this.markDownloadFailed(episode.id);
        } catch (dbError) {
          logger.error(`Failed to mark episode as failed: ${dbError}`);
        }
      }

      // Add delay to avoid overwhelming servers
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info(`Download summary: ${successCount} successful, ${failureCount} failed`);
  }

  private async getUndownloadedEpisodes(): Promise<schema.Episode[]> {
    return await this.database.db
      .select()
      .from(schema.episodes)
      .where(
        and(
          eq(schema.episodes.downloadSuccess, false),
          // Only episodes with enclosure URLs
          // Note: Drizzle doesn't have a direct isNotNull, so we use a workaround
        )
      )
      .limit(1000); // Limit to prevent memory issues
  }

  private async downloadAndUploadEpisode(episode: schema.Episode): Promise<void> {
    if (!episode.enclosureUrl) {
      throw new Error('No enclosure URL found');
    }

    logger.info(`Downloading episode from: ${episode.enclosureUrl}`);

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const fileData = await this.downloadFileWithRetry(episode.enclosureUrl, attempt);
        await this.processDownloadedFile(episode, fileData);
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.info(`Download attempt ${attempt} failed, retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error(`Download failed after ${maxRetries} attempts`);
  }

  private async downloadFileWithRetry(url: string, attempt: number): Promise<Buffer> {
    logger.info(`Download attempt ${attempt} for: ${url}`);

    const response = await fetch(url, {
      headers: this.httpClient.headers,
      signal: AbortSignal.timeout(this.httpClient.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to download: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      logger.info(`Downloading file of size: ${contentLength} bytes`);
    }

    const buffer = await response.arrayBuffer();
    logger.info(`Download completed: ${buffer.byteLength} bytes`);
    
    return Buffer.from(buffer);
  }

  private async processDownloadedFile(episode: schema.Episode, fileData: Buffer): Promise<void> {
    // Determine file extension
    const fileExtension = this.determineFileExtension(
      episode.enclosureUrl || '',
      episode.enclosureType
    );
    const filename = `${episode.id}.${fileExtension}`;

    // Create temporary file
    const tempPath = join(tmpdir(), filename);
    await fs.writeFile(tempPath, fileData);
    logger.info(`Episode saved to temp file: ${tempPath}`);

    try {
      // Upload to MinIO
      const minioPath = filename;
      await this.uploadToMinio(tempPath, minioPath);

      // Update database record
      await this.markDownloadSuccess(episode.id, minioPath);
    } finally {
      // Cleanup temporary file
      try {
        await fs.unlink(tempPath);
      } catch (error) {
        logger.warn(`Failed to cleanup temp file: ${error}`);
      }
    }
  }

  private determineFileExtension(url: string, contentType?: string | null): string {
    // Try to extract extension from URL
    const urlParts = url.split('.');
    const lastPart = urlParts[urlParts.length - 1];
    if (['mp3', 'm4a', 'wav', 'flac', 'ogg'].includes(lastPart)) {
      return lastPart;
    }

    // Determine from content type
    switch (contentType) {
      case 'audio/mpeg':
        return 'mp3';
      case 'audio/mp4':
      case 'audio/m4a':
        return 'm4a';
      case 'audio/wav':
        return 'wav';
      case 'audio/flac':
        return 'flac';
      case 'audio/ogg':
        return 'ogg';
      default:
        return 'mp3'; // Default to mp3
    }
  }

  private async uploadToMinio(localPath: string, minioPath: string): Promise<void> {
    logger.info(`Uploading file to MinIO: ${localPath} -> ${minioPath}`);

    const fileContent = await fs.readFile(localPath);
    const contentType = this.determineContentTypeFromPath(localPath);

    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: minioPath,
      Body: fileContent,
      ContentType: contentType,
    }));

    logger.info(`File uploaded successfully to MinIO: ${minioPath}`);
  }

  private determineContentTypeFromPath(path: string): string {
    const extension = path.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'mp3':
        return 'audio/mpeg';
      case 'm4a':
        return 'audio/mp4';
      case 'wav':
        return 'audio/wav';
      case 'flac':
        return 'audio/flac';
      case 'ogg':
        return 'audio/ogg';
      default:
        return 'audio/mpeg';
    }
  }

  private async markDownloadSuccess(episodeId: string, minioPath: string): Promise<void> {
    await this.database.db
      .update(schema.episodes)
      .set({
        downloadSuccess: true,
        downloadedAt: new Date(),
        minioPath,
        updatedAt: new Date(),
      })
      .where(eq(schema.episodes.id, episodeId));
  }

  private async markDownloadFailed(episodeId: string): Promise<void> {
    await this.database.db
      .update(schema.episodes)
      .set({
        downloadSuccess: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.episodes.id, episodeId));
  }
}
