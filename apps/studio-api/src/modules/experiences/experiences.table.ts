import { bigint, boolean, integer, jsonb, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { productSchema } from '@/infrastructure/db/product-schema';

/**
 * `product.experiences` - Experience metadata and configuration overview.
 */
export const experiences = productSchema.table('experiences', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  activity_type: text('activity_type').notNull().default('personality_assessment'),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

/**
 * `product.experience_drafts` - Mutable draft configuration for an experience.
 * Protected by optimistic concurrency locking on `revision`.
 */
export const experienceDrafts = productSchema.table('experience_drafts', {
  draft_id: text('draft_id').primaryKey(),
  experience_id: text('experience_id')
    .notNull()
    .unique()
    .references(() => experiences.id, { onDelete: 'cascade' }),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  content_hash: text('content_hash').notNull(),
  content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}),
  updated_by: text('updated_by').notNull().default('admin'),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

/**
 * `product.experience_releases` - Immutable published experience releases.
 * Direct SQL UPDATE/DELETE is blocked by a PostgreSQL trigger.
 */
export const experienceReleases = productSchema.table(
  'experience_releases',
  {
    id: text('id').primaryKey(),
    experience_id: text('experience_id')
      .notNull()
      .references(() => experiences.id),
    definition_version: text('definition_version').notNull(),
    definition_hash: text('definition_hash').notNull(),
    definition_schema_version: text('definition_schema_version').notNull(),
    engine_version: text('engine_version').notNull(),
    is_demo: boolean('is_demo').notNull().default(false),
    approval_refs: jsonb('approval_refs').$type<string[]>().notNull().default([]),
    validation_id: text('validation_id').notNull(),
    evaluation_id: text('evaluation_id').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    published_at: timestamp('published_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    published_by: text('published_by').notNull(),
  },
  (table) => [
    unique('experience_releases_exp_id_def_ver_unique').on(table.experience_id, table.definition_version),
  ],
);

/**
 * `product.idempotency_records` - Scoped idempotency records ensuring safe request replays.
 */
export const idempotencyRecords = productSchema.table(
  'idempotency_records',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    request_hash: text('request_hash').notNull(),
    response_status: integer('response_status').notNull(),
    response_body: jsonb('response_body').$type<Record<string, unknown>>().notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
  ],
);
