import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  minio: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    useSSL: boolean;
    bucket: string;
  };
}

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config: Config = {
  database: {
    host: getEnv('DB_HOST', 'localhost'),
    port: parseInt(getEnv('DB_PORT', '5432')),
    user: getEnv('DB_USER', 'postgres'),
    password: getEnv('DB_PASSWORD', 'password'),
    name: getEnv('DB_NAME', 'podcast_db'),
  },
  minio: {
    endpoint: getEnv('MINIO_ENDPOINT', 'localhost:9000'),
    accessKey: getEnv('MINIO_ACCESS_KEY', 'minioadmin'),
    secretKey: getEnv('MINIO_SECRET_KEY', 'minioadmin'),
    useSSL: getEnv('MINIO_USE_SSL', 'false') === 'true',
    bucket: getEnv('MINIO_BUCKET', 'podcasts'),
  },
};
