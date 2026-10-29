import { isIP } from 'node:net';
import { z, ZodError } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const cookieNames = {
  AUTH_COOKIE_ACCESS: z.string().default('sda_access'),
  AUTH_COOKIE_REFRESH: z.string().default('sda_refresh'),
};

// Product DB/auth env: lazily parsed, required only when Product DB/auth starts.
const productSchema = z.object({
  DATABASE_URL: z.string({ required_error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
  SECRET_KEY: z.string({ required_error: 'SECRET_KEY is required' }).min(1, 'SECRET_KEY is required'),
  ACCESS_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().min(15).max(60).default(30),
  REFRESH_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().min(10080).max(43200).default(20160),
  RUNTIME_READY_URL: z.string().url().optional(),
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
  AUTH_TRUSTED_PROXY_HOSTS: z.string().max(1024).default('').transform(value => value.split(',').map(host => host.trim()).filter(Boolean))
    .refine(hosts => hosts.length <= 16 && hosts.every(host => isIP(host) > 0 || /^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/.test(host)), 'Expected explicit proxy IP addresses or DNS names'),
  PRODUCT_BASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
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

// Knowledge env: parsed only by the knowledge module; routes answer 503 while it is incomplete.
const knowledgeSchema = z.object({
  KNOWLEDGE_DATABASE_URL: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  KNOWLEDGE_EMBEDDING_MODELS: z.preprocess(blankToUndefined, z.string().default('gemini-embedding-2'))
    .transform(value => value.split(',').map(model => model.trim()).filter(Boolean))
    .refine(models => models.length > 0 && models.every(model => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(model)),
      'Expected a comma-separated list of embedding model ids'),
  RUNTIME_INTERNAL_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  STUDIO_RUNTIME_SIGNING_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  STUDIO_RUNTIME_SIGNING_KID: z.preprocess(blankToUndefined, z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default('studio')),
});

export type KnowledgeEnv = z.infer<typeof knowledgeSchema>;

export function parseKnowledgeEnv(source: Record<string, string | undefined>): KnowledgeEnv {
  return knowledgeSchema.parse(source);
}

export function getKnowledgeEnv(): KnowledgeEnv {
  return configured('knowledge', () => parseKnowledgeEnv(process.env));
}

// Conversation BFF env: student chat forwarded to the runtime; routes answer 503 while it is incomplete.
const conversationSchema = z.object({
  RUNTIME_INTERNAL_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  // Same canonical Base64 key as the runtime's RUNTIME_INTERNAL_KEYRING entry `kid`; never the studio key.
  PRODUCT_RUNTIME_SIGNING_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  PRODUCT_RUNTIME_SIGNING_KID: z.preprocess(blankToUndefined, z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default('local')),
  SECRET_KEY: productSchema.shape.SECRET_KEY,
  OWNER_COOKIE_MAX_AGE_SECONDS: z.coerce.number().int().min(3600).max(2592000).default(2592000),
});

export type ConversationEnv = z.infer<typeof conversationSchema>;

export function parseConversationEnv(source: Record<string, string | undefined>): ConversationEnv {
  return conversationSchema.parse(source);
}

export function getConversationEnv(): ConversationEnv {
  return configured('conversation', () => parseConversationEnv(process.env));
}

// Agent delivery env: verify key for runtime -> studio-api calls; routes answer 503 while it is missing.
const agentSchema = z.object({
  PRODUCT_DELIVERY_VERIFY_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  PRODUCT_DELIVERY_VERIFY_KID: z.preprocess(blankToUndefined, z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default('runtime')),
  // The only environment this studio delivers releases for.
  AGENT_DELIVERY_ENVIRONMENT: z.preprocess(blankToUndefined, z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/).default('demo')),
});

export type AgentEnv = z.infer<typeof agentSchema>;

export function getAgentEnv(): AgentEnv {
  return configured('agent', () => agentSchema.parse(process.env));
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
