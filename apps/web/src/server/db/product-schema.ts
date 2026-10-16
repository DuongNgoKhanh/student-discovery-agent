import 'server-only';
import { pgSchema } from 'drizzle-orm/pg-core';

/** Postgres schema owned by the TypeScript Product layer (users, versions, migration journal). */
export const productSchema = pgSchema('product');
