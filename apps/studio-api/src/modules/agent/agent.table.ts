import { bigint, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { productSchema } from '@/infrastructure/db/product-schema';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' }).defaultNow().notNull();

/** `product.agent_draft` - the single editable agent config; may be invalid until published. */
export const agentDraft = productSchema.table('agent_draft', {
  id: text('id').primaryKey().default('default'),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  content_hash: text('content_hash').notNull(),
  updated_by: text('updated_by').notNull(),
  updated_at: at('updated_at'),
});

/** `product.agent_releases` - immutable published agent configs; a DB trigger blocks UPDATE/DELETE. */
export const agentReleases = productSchema.table('agent_releases', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().unique('agent_releases_version_unique'),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  content_hash: text('content_hash').notNull(),
  draft_revision: bigint('draft_revision', { mode: 'number' }).notNull(),
  note: text('note'),
  created_by: text('created_by').notNull(),
  created_at: at('created_at'),
});

/** `product.agent_active` - the one active release pointer, guarded by `revision`. */
export const agentActive = productSchema.table('agent_active', {
  id: text('id').primaryKey().default('default'),
  release_id: text('release_id').notNull().references(() => agentReleases.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  updated_by: text('updated_by').notNull(),
  updated_at: at('updated_at'),
});

/** `product.audit_events` - who changed what; experiences reuse it later. Never stores full configs. */
export const auditEvents = productSchema.table('audit_events', {
  id: text('id').primaryKey(),
  at: at('at'),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target_kind: text('target_kind').notNull(),
  target_id: text('target_id').notNull(),
  before_ref: text('before_ref'),
  after_ref: text('after_ref'),
  outcome: text('outcome').$type<'success' | 'rejected'>().notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
});
