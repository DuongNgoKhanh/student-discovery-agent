import 'server-only';
import { z } from 'zod';
import type { components as AdminComponents } from '@/generated/api/admin-api';
import type { components } from '@/generated/api/user-api';

/**
 * Pydantic `EmailStr` normalization used by legacy: domain lower-cased, local part kept.
 */
const email = z
  .string()
  .trim()
  .max(255)
  .email()
  .transform((v) => {
    const at = v.lastIndexOf('@');
    return v.slice(0, at) + v.slice(at).toLowerCase();
  });

const optionalText = (max?: number) => (max ? z.string().max(max) : z.string()).nullish();

// Registration policy is applied in the service (legacy returned 400, not 422).
export const registerSchema = z.object({
  email,
  password: z.string(),
  name: optionalText(255),
  avatar_url: optionalText(500),
  bio: optionalText(),
  position: optionalText(255),
}) satisfies z.ZodType<unknown, z.ZodTypeDef, components['schemas']['RegisterRequest']>;

// No policy/length check on login: existing accounts may predate the policy.
export const loginSchema = z.object({
  email,
  password: z.string().min(1),
}) satisfies z.ZodType<unknown, z.ZodTypeDef, components['schemas']['LoginRequest']>;

/** Body is optional: browser flow falls back to the refresh cookie. */
export const refreshSchema = z
  .object({ refresh_token: z.string().min(1).optional() })
  .optional();

export const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
}) satisfies z.ZodType<unknown, z.ZodTypeDef, AdminComponents['schemas']['AdminLoginRequest']>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

type AuthResponseData = components['schemas']['AuthResponse']['data'];
/** Flat auth payload (`data.user` + tokens directly in `data`, never `data.token`). */
export type AuthData = Required<AuthResponseData>;
export type TokenRefreshData = components['schemas']['TokenRefreshResponse']['data'];
export type AdminTokenData = AdminComponents['schemas']['AdminTokenResponse'];
