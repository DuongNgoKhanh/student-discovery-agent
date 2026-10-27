import type { MetadataField } from '../types';

export function toFormValues(fields: MetadataField[], metadata: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(fields.map(field => {
    const value = metadata[field.name];
    if (value === undefined || value === null) return [field.name, ''];
    return [field.name, Array.isArray(value) ? value.join('; ') : String(value)];
  }));
}

/** Empty inputs mean "no value"; the server still validates every type. */
export function fromFormValues(fields: MetadataField[], values: Record<string, string>) {
  const metadata: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const field of fields) {
    const raw = (values[field.name] ?? '').trim();
    if (raw === '') continue;
    if (field.type === 'number') {
      const value = Number(raw);
      if (Number.isFinite(value)) metadata[field.name] = value;
      else errors.push(`${field.name}: không phải số`);
    } else if (field.type === 'string_list') {
      metadata[field.name] = raw.split(';').map(item => item.trim()).filter(Boolean);
    } else {
      metadata[field.name] = raw;
    }
  }
  return { metadata, errors };
}
