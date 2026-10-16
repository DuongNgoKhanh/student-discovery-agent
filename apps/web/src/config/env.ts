import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const cookieNames = {
  AUTH_COOKIE_ACCESS: z.string().default('sda_access'),
  AUTH_COOKIE_REFRESH: z.string().default('sda_refresh'),
};

// Legacy BFF schema (API_BASE_URL is used until Task 7 removes the BFF).
const schema = z.object({
  API_BASE_URL: z.string().url(),
  ...cookieNames,
  NODE_ENV: nodeEnv,
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source);
}

/** Đọc env đã validate. CHỈ dùng ở server (route handler / RSC). */
export function getServerEnv(): Env {
  return parseEnv(process.env);
}

// Product DB/auth env: lazily parsed, required only when Product DB/auth starts.
const productSchema = z.object({
  DATABASE_URL: z.string({ required_error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
  SECRET_KEY: z.string({ required_error: 'SECRET_KEY is required' }).min(1, 'SECRET_KEY is required'),
  ACCESS_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().positive().default(11520),
  REFRESH_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().positive().default(43200),
  ...cookieNames,
  NODE_ENV: nodeEnv,
});

export type ProductEnv = z.infer<typeof productSchema>;

export function parseProductEnv(source: Record<string, string | undefined>): ProductEnv {
  return productSchema.parse(source);
}

export function getProductEnv(): ProductEnv {
  return parseProductEnv(process.env);
}

// Storage env: parsed only when storage is used. No provider keys live in the web app.
const storageSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
});

export type StorageEnv = z.infer<typeof storageSchema>;

export function parseStorageEnv(source: Record<string, string | undefined>): StorageEnv {
  return storageSchema.parse(source);
}

export function getStorageEnv(): StorageEnv {
  return parseStorageEnv(process.env);
}
