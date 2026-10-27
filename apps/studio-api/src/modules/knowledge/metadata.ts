import { ProductError } from '@/http/errors';

/** Port of agent_runtime.knowledge.metadata: name-keyed values in, field-id-keyed storage out. */
export const FIELD_TYPES = ['string', 'number', 'time', 'string_list'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface MetadataField {
  id: string;
  name: string;
  type: FieldType;
  filterable?: boolean;
  label?: string;
  ordinal?: number;
}

export const MAX_STRING = 2000;
export const MAX_LIST_ITEMS = 50;
export const MAX_LIST_ITEM = 200;

export interface MetadataIssue {
  field: string;
  message: string;
}

export class MetadataValidationError extends Error {
  constructor(public readonly issues: MetadataIssue[]) {
    super('Invalid metadata');
    this.name = 'MetadataValidationError';
  }
}

// Python's len() counts code points, not UTF-16 units.
const codePoints = (value: string) => [...value].length;

const TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Extended ISO dates/datetimes that Python's fromisoformat accepts and Postgres can cast. */
export function isTime(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = TIME.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  if (day > (month === 2 && leap(year) ? 29 : DAYS[month - 1]!)) return false;
  if (match[4] !== undefined && (Number(match[4]) > 23 || Number(match[5]) > 59)) return false;
  if (match[6] !== undefined && Number(match[6]) > 59) return false;
  if (match[7] !== undefined && (Number(match[7]) > 23 || Number(match[8]) > 59)) return false;
  return true;
}

function isValidValue(type: FieldType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string' && codePoints(value) <= MAX_STRING;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'time':
      return isTime(value);
    case 'string_list':
      return Array.isArray(value) && value.length <= MAX_LIST_ITEMS
        && value.every(item => typeof item === 'string' && item.length > 0 && codePoints(item) <= MAX_LIST_ITEM);
  }
}

export function validateMetadata(fields: readonly MetadataField[], values: Record<string, unknown>): Record<string, unknown> {
  const byName = new Map(fields.map(field => [field.name, field]));
  const stored: Record<string, unknown> = {};
  const issues: MetadataIssue[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    const field = byName.get(name);
    if (!field) {
      issues.push({ field: name, message: `Unknown metadata field: ${name}` });
    } else if (!isValidValue(field.type, value)) {
      issues.push({ field: name, message: `Expected ${field.type}` });
    } else {
      stored[field.id] = value;
    }
  }
  if (issues.length > 0) throw new MetadataValidationError(issues);
  return stored;
}

/** Stored values whose field was deleted are dropped, like the runtime does when reading. */
export function namedMetadata(fields: readonly MetadataField[], stored: Record<string, unknown>): Record<string, unknown> {
  const byId = new Map(fields.map(field => [field.id, field.name]));
  return Object.fromEntries(Object.entries(stored).flatMap(([id, value]) => {
    const name = byId.get(id);
    return name === undefined ? [] : [[name, value]];
  }));
}

export function invalidMetadata(error: MetadataValidationError): ProductError {
  return new ProductError(422, 'VAL_INVALID_INPUT', 'Invalid metadata', false, {
    kind: 'validation',
    issues: error.issues.map(issue => ({
      path: `metadata.${issue.field}`, code: 'invalid_metadata', message: issue.message, rule_id: null,
    })),
  });
}
