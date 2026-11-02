import { z } from 'zod';
import { idempotencyKeySchema } from '@/modules/experiences/experiences.schemas';
import { FIELD_TYPES } from '@/modules/knowledge/metadata';

export const MAX_BODY_BYTES = 262_144;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const kbIdSchema = z.string().min(1).max(128).regex(ID, 'Identifier must match ^[A-Za-z0-9][A-Za-z0-9._-]*$');
export const documentIdSchema = kbIdSchema;
export const fieldNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Field name must match ^[a-z][a-z0-9_]{0,63}$');
const fieldTypeSchema = z.enum(FIELD_TYPES);

export const createKnowledgeBaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  embedding_model: z.string().min(1).max(128),
}).strict();

export const patchKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Nothing to change');

export const createFieldSchema = z.object({
  name: fieldNameSchema,
  type: fieldTypeSchema,
  label: z.string().max(200).default(''),
  filterable: z.boolean().default(false),
  ordinal: z.number().int().min(0).max(10_000).default(0),
}).strict();

export const patchFieldSchema = z.object({
  name: z.string().optional(),
  type: fieldTypeSchema.optional(),
  label: z.string().max(200).optional(),
  filterable: z.boolean().optional(),
  ordinal: z.number().int().min(0).max(10_000).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Nothing to change');

export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>;
export type PatchKnowledgeBaseInput = z.infer<typeof patchKnowledgeBaseSchema>;
export type CreateFieldInput = z.infer<typeof createFieldSchema>;
export type PatchFieldInput = z.infer<typeof patchFieldSchema>;

/** Postgres text/jsonb reject U+0000, so it must be a validation error rather than a failed insert. */
const NUL_MESSAGE = 'Không được chứa ký tự NUL (U+0000)';
const noNul = (value: string) => !value.includes('\u0000');
const hasNul = (value: unknown): boolean => {
  if (typeof value === 'string') return !noNul(value);
  if (Array.isArray(value)) return value.some(hasNul);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => !noNul(key) || hasNul(item));
  }
  return false;
};

export const documentContentSchema = z.object({
  title: z.string().max(300).refine(value => /\S/.test(value), 'Title must not be blank').refine(noNul, NUL_MESSAGE),
  body: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= MAX_BODY_BYTES, 'Body exceeds 262144 bytes')
    .refine(noNul, NUL_MESSAGE),
  source_url: z.string().max(2000).url().refine(value => /^https?:\/\//i.test(value), 'Expected an http(s) URL')
    .refine(noNul, NUL_MESSAGE).nullable().default(null),
  metadata: z.record(z.unknown()).refine(value => !hasNul(value), NUL_MESSAGE).default({}),
}).strict();

export type DocumentContent = z.infer<typeof documentContentSchema>;

export const putDocumentSchema = documentContentSchema.extend({
  expected_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

export const statusChangeSchema = z.object({ expected_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();

export const listDocumentsQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  index_status: z.enum(['pending', 'indexing', 'ready', 'error']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

const MAX_ROWS = 200;

export const importPreviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('files'),
    files: z.array(z.object({ name: z.string().min(1).max(255), content: z.string() }).strict()).min(1).max(MAX_ROWS + 1),
  }).strict(),
  z.object({
    kind: z.literal('csv'),
    content: z.string().min(1),
    mapping: z.object({
      document_id: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
      source_url: z.string().min(1).optional(),
      metadata: z.record(z.string().min(1)).default({}),
    }).strict(),
  }).strict(),
]);

export const importCommitSchema = z.object({
  idempotency_key: idempotencyKeySchema.max(256),
  rows: z.array(z.object({
    row: z.number().int().min(1),
    document_id: documentIdSchema,
    expected_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    payload: documentContentSchema,
  }).strict()).min(1).max(MAX_ROWS),
}).strict();

export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

export const searchSchema = z.object({
  query: z.string().max(300).refine(value => /\S/.test(value), 'Query must not be blank'),
  top_k: z.number().int().min(1).max(20).default(4),
  score_threshold: z.number().min(0).max(1).optional(),
  semantic_weight: z.number().min(0).max(1).optional(),
  max_chunks_per_doc: z.number().int().min(1).max(10).optional(),
  metadata_condition: z.object({
    logical_operator: z.enum(['and', 'or']).optional(),
    conditions: z.array(z.object({
      name: z.string().min(1), comparison_operator: z.string().min(1).max(16), value: z.unknown().optional(),
    }).strict()).min(1).max(10),
  }).strict().optional(),
}).strict();

export type SearchInput = z.infer<typeof searchSchema>;
