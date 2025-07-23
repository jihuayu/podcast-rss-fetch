import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

const connectionString = `postgresql://${config.database.user}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.name}`;

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export class Database {
  public db = db;

  constructor() {}

  async connect(): Promise<void> {
    try {
      // Test connection
      await this.db.select().from(schema.tenants).limit(1);
      logger.info('Connected to database successfully');
      
      // Ensure default tenant exists
      await this.ensureDefaultTenant();
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  private async ensureDefaultTenant(): Promise<void> {
    const defaultTenantId = '00000000-0000-0000-0000-000000000001';
    
    try {
      const existingTenant = await this.db
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.id, defaultTenantId))
        .limit(1);

      if (existingTenant.length === 0) {
        logger.info('Creating default tenant');
        await this.db.insert(schema.tenants).values({
          id: defaultTenantId,
          name: 'Default Tenant',
          description: 'Default tenant for podcast management',
        });
      }
    } catch (error) {
      logger.error('Error ensuring default tenant:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await client.end();
  }
}
