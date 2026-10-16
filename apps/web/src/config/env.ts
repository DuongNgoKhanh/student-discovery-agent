import { z } from 'zod';

const schema = z.object({
  API_BASE_URL: z.string().url(),
  AUTH_COOKIE_ACCESS: z.string().default('sda_access'),
  AUTH_COOKIE_REFRESH: z.string().default('sda_refresh'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source);
}

/**
 * Đọc env đã validate. CHỈ dùng ở server (route handler / RSC).
 * KHÔNG import ở client component — biến này không có prefix NEXT_PUBLIC.
 */
export function getServerEnv(): Env {
  return parseEnv(process.env);
}
