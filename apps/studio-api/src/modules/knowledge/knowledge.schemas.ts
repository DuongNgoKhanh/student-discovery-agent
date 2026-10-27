import { z } from 'zod';
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

export const documentContentSchema = z.object({
  title: z.string().max(300).refine(value => /\S/.test(value), 'Title must not be blank'),
  body: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= MAX_BODY_BYTES, 'Body exceeds 262144 bytes'),
  source_url: z.string().max(2000).url().refine(value => /^https?:\/\//i.test(value), 'Expected an http(s) URL')
    .nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
}).strict();

export type DocumentContent = z.infer<typeof documentContentSchema>;

export const putDocumentSchema = documentContentSchema.extend({
  expected_revision: z.number().int().min(0),
}).strict();

export const statusChangeSchema = z.object({ expected_revision: z.number().int().min(1) }).strict();

export const listDocumentsQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  index_status: z.enum(['pending', 'indexing', 'ready', 'error']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
