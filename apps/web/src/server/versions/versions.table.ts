import 'server-only';
import { boolean, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { productSchema } from '../db/product-schema';

/** `product.versions` — mirrors the legacy SQLModel `Version` (app/models/version.py). */
export const versions = productSchema.table('versions', {
  id: serial('id').primaryKey(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  version: varchar('version', { length: 50 }).notNull().unique(),
  description: varchar('description', { length: 500 }),
  is_current: boolean('is_current')
    .notNull()
    .$defaultFn(() => false),
  is_deprecated: boolean('is_deprecated')
    .notNull()
    .$defaultFn(() => false),
});
