import { documentIdSchema } from '@/modules/knowledge/knowledge.schemas';
import type { FieldType } from '@/modules/knowledge/metadata';
import { documentIdFromFilename, slugify } from '@/modules/knowledge/slug';

export const MAX_IMPORT_ROWS = 200;

/** The whole import request is unusable (bad CSV, unknown column...), as opposed to one bad row. */
export class ImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportInputError';
  }
}

export interface ImportFile {
  name: string;
  content: string;
}

export interface CsvMapping {
  document_id?: string;
  title?: string;
  body?: string;
  source_url?: string;
  metadata: Record<string, string>;
}

/** `undefined` means "not mapped, keep the current value"; a `null` metadata value clears it. */
export interface ParsedRow {
  row: number;
  source: string;
  documentId: string | null;
  title?: string;
  body?: string;
  sourceUrl?: string | null;
  metadata: Record<string, unknown>;
  errors: string[];
}

const stripBom = (text: string) => text.replace(/^﻿/, '');

export function firstHeading(markdown: string): string | null {
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}

export function parseFiles(files: ImportFile[]): ParsedRow[] {
  if (files.length > MAX_IMPORT_ROWS) throw new ImportInputError(`Tối đa ${MAX_IMPORT_ROWS} file mỗi lần`);
  return files.map((file, index) => {
    const errors: string[] = [];
    if (!/\.(md|markdown|txt)$/i.test(file.name)) errors.push('Chỉ nhận file .md, .markdown hoặc .txt');
    const documentId = documentIdFromFilename(file.name) || null;
    if (!documentId) errors.push('Không tạo được document_id từ tên file');
    const body = stripBom(file.content);
    return {
      row: index + 1, source: file.name, documentId,
      title: firstHeading(body) ?? file.name.replace(/\.[^.]+$/, ''), body, metadata: {}, errors,
    };
  });
}

/** RFC 4180: quoted cells may hold commas, line breaks and doubled quotes. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const input = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new ImportInputError('CSV có dấu ngoặc kép chưa đóng');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(cells => cells.some(value => value.trim() !== ''));
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function coerceCell(type: FieldType, raw: string): unknown {
  if (type === 'number') return NUMBER.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  if (type === 'string_list') return raw.split(';').map(item => item.trim()).filter(Boolean);
  return raw;
}

export function parseCsvRows(
  text: string,
  mapping: CsvMapping,
  fields: ReadonlyArray<{ name: string; type: FieldType }>,
): ParsedRow[] {
  const [header, ...data] = parseCsv(text);
  if (!header) throw new ImportInputError('File CSV trống');
  if (data.length > MAX_IMPORT_ROWS) throw new ImportInputError(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần`);
  const column = (name: string | undefined) => {
    if (name === undefined) return undefined;
    const index = header.findIndex(cell => cell.trim() === name);
    if (index < 0) throw new ImportInputError(`Không có cột "${name}"`);
    return index;
  };
  const idColumn = column(mapping.document_id);
  const titleColumn = column(mapping.title);
  const bodyColumn = column(mapping.body);
  const sourceColumn = column(mapping.source_url);
  if (idColumn === undefined && titleColumn === undefined) throw new ImportInputError('Cần map cột document_id hoặc title');
  const byName = new Map(fields.map(field => [field.name, field]));
  const metadataColumns = Object.entries(mapping.metadata).map(([name, columnName]) => {
    const field = byName.get(name);
    if (!field) throw new ImportInputError(`Field "${name}" không tồn tại`);
    return [field, column(columnName)!] as const;
  });

  return data.map((cells, index) => {
    const errors: string[] = [];
    const cell = (at: number | undefined) => (at === undefined ? undefined : (cells[at] ?? '').trim());
    const title = cell(titleColumn) || undefined;
    const rawId = cell(idColumn);
    let documentId: string | null = null;
    if (rawId) {
      if (documentIdSchema.safeParse(rawId).success) documentId = rawId;
      else errors.push(`document_id không hợp lệ: "${rawId}"`);
    } else if (title) {
      documentId = slugify(title) || null;
    }
    if (!documentId && errors.length === 0) errors.push('Thiếu document_id');
    const metadata: Record<string, unknown> = {};
    for (const [field, at] of metadataColumns) {
      const raw = cell(at)!;
      if (raw === '') {
        metadata[field.name] = null;
        continue;
      }
      const value = coerceCell(field.type, raw);
      if (value === undefined) errors.push(`${field.name}: "${raw}" không phải ${field.type}`);
      else metadata[field.name] = value;
    }
    return {
      row: index + 1,
      source: `dòng ${index + 2}`,
      documentId,
      title,
      body: bodyColumn === undefined ? undefined : cells[bodyColumn] ?? '',
      sourceUrl: sourceColumn === undefined ? undefined : cell(sourceColumn) || null,
      metadata,
      errors,
    };
  });
}
