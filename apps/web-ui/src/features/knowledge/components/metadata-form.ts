import type { MetadataField } from '../types';

/** Form values are plain strings; a string_list is stored as "a; b" so every field type shares one shape. */
export function toFormValues(fields: MetadataField[], metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(fields.map(field => {
    const value = metadata[field.name];
    if (value === undefined || value === null) return [field.name, ''];
    return [field.name, Array.isArray(value) ? joinList(value.map(String)) : String(value)];
  }));
}

export const splitList = (raw: string) => raw.split(';').map(item => item.trim()).filter(Boolean);
export const joinList = (items: string[]) => items.join('; ');

// Same shape the server accepts (Python fromisoformat-compatible dates/datetimes).
const TIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/;

/** Value for `<input type="datetime-local">`; null when the stored time has seconds/offset the input would drop. */
export function toDateTimeLocal(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return '';
  if (DATE_ONLY.test(value)) return `${value}T00:00`;
  const match = MINUTES.exec(value);
  return match ? `${match[1]}T${match[2]}` : null;
}

/** Midnight round-trips to a plain date so a date-only value never changes just by opening the editor. */
export const fromDateTimeLocal = (value: string) => (value.endsWith('T00:00') ? value.slice(0, 10) : value);

/** Read-only text for the label–value list. */
export function displayValue(field: MetadataField, raw: string): string {
  return field.type === 'string_list' ? splitList(raw).join(' · ') : raw.trim();
}

/**
 * Empty inputs mean "no value"; the server still validates every type. `issues` holds one message per field name
 * for inline errors, `errors` the same as "name: message" lines.
 */
export function fromFormValues(fields: MetadataField[], values: Record<string, string>) {
  const metadata: Record<string, unknown> = {};
  const issues: Record<string, string> = {};
  for (const field of fields) {
    const raw = (values[field.name] ?? '').trim();
    if (raw === '') continue;
    if (field.type === 'number') {
      const value = Number(raw);
      if (Number.isFinite(value)) metadata[field.name] = value;
      else issues[field.name] = 'không phải số';
    } else if (field.type === 'string_list') {
      metadata[field.name] = splitList(raw);
    } else if (field.type === 'time' && !TIME.test(raw)) {
      issues[field.name] = 'không phải ngày giờ hợp lệ';
    } else {
      metadata[field.name] = raw;
    }
  }
  const errors = Object.entries(issues).map(([name, message]) => `${name}: ${message}`);
  return { metadata, errors, issues };
}
