import { z, ZodError } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const cookieNames = {
  AUTH_COOKIE_ACCESS: z.string().default('sda_access'),
  AUTH_COOKIE_REFRESH: z.string().default('sda_refresh'),
};

// Cookie-name env shared by session helpers.
const schema = z.object({
  ...cookieNames,
  NODE_ENV: nodeEnv,
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source);
}

/** Đọc env đã validate. CHỈ dùng ở server (route handler / RSC). */
export function getServerEnv(): Env {
  return configured('server', () => parseEnv(process.env));
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
  return configured('product', () => parseProductEnv(process.env));
}

// Auth env: token signing/cookies only (no DB), so getSession() works without DATABASE_URL.
// ADMIN_PASSWORD has NO default: when unset/empty, admin login always fails (security ruling).
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const authSchema = z.object({
  SECRET_KEY: productSchema.shape.SECRET_KEY,
  ACCESS_TOKEN_EXPIRE_MINUTES: z.preprocess(blankToUndefined, productSchema.shape.ACCESS_TOKEN_EXPIRE_MINUTES),
  REFRESH_TOKEN_EXPIRE_MINUTES: z.preprocess(blankToUndefined, productSchema.shape.REFRESH_TOKEN_EXPIRE_MINUTES),
  ADMIN_USERNAME: z.preprocess(blankToUndefined, z.string().default('admin')),
  ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().optional()),
  ...cookieNames,
  NODE_ENV: nodeEnv,
});

export type AuthEnv = z.infer<typeof authSchema>;

export function parseAuthEnv(source: Record<string, string | undefined>): AuthEnv {
  return authSchema.parse(source);
}

export function getAuthEnv(): AuthEnv {
  return configured('auth', () => parseAuthEnv(process.env));
}

// Storage env: parsed only when storage is used. No provider keys live in the web app.
const storageSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  // Legacy MINIO_PUBLIC_BUCKET_NAME (avatars) and absolute Product origin; required only by avatar/download code.
  MINIO_PUBLIC_BUCKET_NAME: z.string().min(1).optional(),
  PRODUCT_BASE_URL: z.string().url().optional(),
});

export type StorageEnv = z.infer<typeof storageSchema>;

export function parseStorageEnv(source: Record<string, string | undefined>): StorageEnv {
  return storageSchema.parse(source);
}

export function getStorageEnv(): StorageEnv {
  return configured('storage', () => parseStorageEnv(process.env));
}

/** Lazy getters must not leak ZodError (mapped to 422 by the HTTP layer): env problems are server faults. */
function configured<T>(name: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError) {
      const vars = error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Invalid ${name} environment configuration: ${vars}`);
    }
    throw error;
  }
}
