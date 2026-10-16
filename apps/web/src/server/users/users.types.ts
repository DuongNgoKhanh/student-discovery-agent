import 'server-only';
import type { users } from './users.table';

/** Full `product.users` row, including the password hash (server-side only). */
export type UserRow = typeof users.$inferSelect;

/** Insert fields already filtered by the server; `id`/timestamps are DB-assigned. */
export type NewUser = Omit<typeof users.$inferInsert, 'id' | 'created_at' | 'updated_at'>;

/** Mutable fields; identity (`id`, `email`) and `created_at` never change, `updated_at` is set by the DB. */
export type UserPatch = Partial<Omit<UserRow, 'id' | 'email' | 'created_at' | 'updated_at'>>;
