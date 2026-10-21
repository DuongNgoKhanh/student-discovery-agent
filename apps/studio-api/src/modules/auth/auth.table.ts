import { integer, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { productSchema } from '@/infrastructure/db/product-schema';
import { users } from '@/modules/users/users.table';
export const authSessions = productSchema.table('auth_sessions', {
  id: uuid('id').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
}, t => [index('auth_sessions_expiry_idx').on(t.expires_at)]);
export const authRefreshTokens = productSchema.table('auth_refresh_tokens', {
  token_hash: varchar('token_hash', { length: 64 }).primaryKey(),
  session_id: uuid('session_id').notNull().references(() => authSessions.id, { onDelete: 'cascade' }),
  consumed_at: timestamp('consumed_at', { withTimezone: true }),
}, t => [index('auth_refresh_session_idx').on(t.session_id)]);
export const authRegistrationLimits = productSchema.table('auth_registration_limits', {
  key_hash: varchar('key_hash', { length: 64 }).primaryKey(),
  attempts: integer('attempts').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [index('auth_registration_expiry_idx').on(t.expires_at)]);
