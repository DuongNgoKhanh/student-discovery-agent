import { boolean, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { productSchema } from '@/infrastructure/db/product-schema';

/**
 * `product.users` — mirrors the legacy SQLModel `User` (app/models/user.py) column for column.
 * `is_deleted` has no DB default in legacy DDL (SQLAlchemy default was client-side), so the
 * default is applied in the insert statement instead of the column definition.
 * `updated_at` equals `created_at` on insert (migration 0004) so clients never handle null.
 */
export const users = productSchema.table('users', {
  id: serial('id').primaryKey(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  is_deleted: boolean('is_deleted')
    .notNull()
    .$defaultFn(() => false),
  email: varchar('email', { length: 255 }).notNull().unique(),
  hashed_password: varchar('hashed_password', { length: 255 }),
  name: varchar('name', { length: 255 }),
  avatar_url: varchar('avatar_url', { length: 500 }),
  bio: text('bio'),
  position: varchar('position', { length: 255 }),
});
