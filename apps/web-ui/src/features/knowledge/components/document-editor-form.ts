import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import type { MetadataField } from '../types';
import { fromFormValues } from './metadata-form';
import { slugify } from './shared/format';

export type EditorForm = { id: string; title: string; body: string; source_url: string; metadata: Record<string, string> };

// Server limits (studio-api knowledge.schemas.ts).
export const TITLE_MAX = 300;
export const BODY_MAX_BYTES = 262_144;
export const SOURCE_URL_MAX = 2000;
export const DOCUMENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const encoder = new TextEncoder();
export const utf8Bytes = (text: string) => encoder.encode(text).length;

/** "12 / 256 KB" style size: one decimal under 10 KB, whole KB above. */
export function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 10 ? kb.toFixed(1).replace(/\.0$/, '') : String(Math.round(kb));
}

const isHttpUrl = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return false;
  try { new URL(value); return true; } catch { return false; }
};

export interface EditorSchemaContext {
  fields: MetadataField[];
  /** Creating a document: the ID is either typed (`customId`) or derived from the title. */
  isNew: boolean;
  customId: boolean;
}

/** IDs that collide with editor routes (`documents/new` is create mode, `documents/import` is the import page). */
export const RESERVED_IDS: readonly string[] = ['new', 'import'];

/** The ID derived from a title, steered off reserved IDs ("New" becomes `new-1`). */
export function derivedId(title: string): string {
  const slug = slugify(title);
  return RESERVED_IDS.includes(slug) ? `${slug}-1` : slug;
}

export const documentIdOf = (values: Pick<EditorForm, 'id' | 'title'>, customId: boolean) =>
  customId ? values.id.trim() : derivedId(values.title);

export function editorSchema({ fields, isNew, customId }: EditorSchemaContext) {
  return z.object({
    id: z.string(),
    title: z.string()
      .refine(value => /\S/.test(value), 'Nhập tiêu đề.')
      .refine(value => value.length <= TITLE_MAX, `Tiêu đề tối đa ${TITLE_MAX} ký tự.`),
    source_url: z.string()
      .refine(value => value.trim().length <= SOURCE_URL_MAX, `Nguồn tối đa ${SOURCE_URL_MAX} ký tự.`)
      .refine(value => value.trim() === '' || isHttpUrl(value.trim()), 'Nguồn phải là địa chỉ http(s), ví dụ https://hutech.edu.vn.'),
    body: z.string().refine(value => utf8Bytes(value) <= BODY_MAX_BYTES, 'Nội dung vượt quá 256 KB, hãy chia nhỏ tài liệu.'),
    metadata: z.record(z.string()),
  }).superRefine((values, ctx) => {
    // With a blank title the title error says enough; a derived ID only matters once there is a title.
    const id = documentIdOf(values, customId);
    if (isNew && (customId || /\S/.test(values.title)) && !DOCUMENT_ID.test(id)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'ID gồm chữ thường a-z, số, "-" hoặc "_", tối đa 64 ký tự.' });
    } else if (isNew && RESERVED_IDS.includes(id)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'ID này dành riêng cho hệ thống, hãy chọn ID khác.' });
    }
    for (const [name, message] of Object.entries(fromFormValues(fields, values.metadata).issues)) {
      ctx.addIssue({ code: 'custom', path: ['metadata', name], message: `Giá trị ${message}.` });
    }
  });
}

export type ServerIssue = { path?: string; message?: string };

/** 422 issues from the server, or [] for any other error. */
export function serverIssues(error: unknown): ServerIssue[] {
  if (!(error instanceof ApiError) || error.httpStatus !== 422) return [];
  return (error.details as { issues?: ServerIssue[] } | undefined)?.issues ?? [];
}

/** Server messages are English; keep them as detail behind a Vietnamese lead-in. */
export const issueText = (issue: ServerIssue) =>
  issue.message && /[^\x00-\x7F]/.test(issue.message) ? issue.message : `Giá trị không hợp lệ${issue.message ? ` (${issue.message})` : ''}.`;

export const FORM_FIELDS = ['title', 'body', 'source_url'] as const;
