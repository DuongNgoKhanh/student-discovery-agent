import { z } from 'zod';
import type { components } from '@/generated/api/admin-api';

const email = z
  .string()
  .trim()
  .max(255)
  .email()
  .transform((v) => {
    const at = v.lastIndexOf('@');
    return v.slice(0, at) + v.slice(at).toLowerCase();
  });
const text = (max?: number) => (max ? z.string().max(max) : z.string()).nullish();

/** Self-service update: only these fields; email/id/password are not accepted (unknown keys stripped). */
export const selfUpdateSchema = z.object({
  name: text(255),
  avatar_url: text(500),
  bio: text(),
  position: text(255),
});

export const adminCreateSchema = z.object({
  email,
  password: z.string().nullish(),
  name: text(255),
  avatar_url: text(500),
  bio: text(),
  position: text(255),
}) satisfies z.ZodType<unknown, z.ZodTypeDef, components['schemas']['AdminUserCreate']>;

export const adminUpdateSchema = z.object({
  name: text(255),
  avatar_url: text(500),
  bio: text(),
  position: text(255),
  password: z.string().nullish(),
  is_deleted: z.boolean().nullish(),
}) satisfies z.ZodType<unknown, z.ZodTypeDef, components['schemas']['AdminUserUpdate']>;

export const bulkCreateSchema = z.object({ users: z.array(adminCreateSchema) });
export const bulkUpdateSchema = z.object({
  users: z.array(z.object({ id: z.number().int(), updates: adminUpdateSchema })),
});
export const bulkDeleteSchema = z.object({ user_ids: z.array(z.number().int()) });

export const userIdSchema = z.coerce.number().int().min(1).max(2_147_483_647);

/** Stable ID keyset order only; unsupported sort values are rejected. */
export const userQuerySchema = z.object({
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order_by: z.literal('id').default('id'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  name: z.string().optional(),
  email: z.string().optional(),
  position: z.string().optional(),
  is_deleted: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  project_id: z.string().optional(),
});

export const publicUserQuerySchema = userQuerySchema.omit({ email: true, is_deleted: true, project_id: true }).strict();

export type UserQuery = z.infer<typeof userQuerySchema>;
export type SelfUpdateInput = z.infer<typeof selfUpdateSchema>;
export type AdminCreateInput = z.infer<typeof adminCreateSchema>;
export type AdminUpdateInput = z.infer<typeof adminUpdateSchema>;
