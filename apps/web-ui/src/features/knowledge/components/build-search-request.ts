import type { FieldType, MetadataField, SearchRequest } from '../types';

export const QUERY_MAX = 300;
export const MAX_CONDITIONS = 10;

/** Must match `OPERATORS` in agent_runtime/knowledge/schemas.py; the runtime rejects anything else. */
export const OPERATORS: Record<FieldType, readonly string[]> = {
  string: ['is', 'is not', 'contains', 'not contains', 'start with', 'end with', 'empty', 'not empty'],
  number: ['=', '≠', '>', '<', '≥', '≤', 'empty', 'not empty'],
  time: ['is', 'before', 'after', 'empty', 'not empty'],
  string_list: ['contains', 'not contains', 'empty', 'not empty'],
};

export const isValueless = (operator: string) => operator === 'empty' || operator === 'not empty';

export interface FilterCondition { id: string; name: string; operator: string; value: string }

export interface SearchSettings {
  /** null = not sent, the server default applies (a cleared number input is null, never NaN). */
  topK: number | null;
  scoreThreshold: number | null;
  semanticWeight: number | null;
  maxChunksPerDoc: number | null;
  logicalOperator: 'and' | 'or';
  conditions: FilterCondition[];
}

export interface SearchState { query: string; settings: SearchSettings }

const DEFAULT_TOP_K = 4;
export const DEFAULT_SETTINGS: SearchSettings = {
  topK: DEFAULT_TOP_K, scoreThreshold: null, semanticWeight: null, maxChunksPerDoc: null, logicalOperator: 'and', conditions: [],
};

type Condition = NonNullable<SearchRequest['metadata_condition']>['conditions'][number];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The wire condition for a row, or null while the row is incomplete or no longer matches a filterable field. */
export function toCondition(row: FilterCondition, fields: MetadataField[]): Condition | null {
  const field = fields.find(item => item.name === row.name && item.filterable);
  if (!field || !OPERATORS[field.type].includes(row.operator)) return null;
  if (isValueless(row.operator)) return { name: field.name, comparison_operator: row.operator };
  const text = row.value.trim();
  if (text === '') return null;
  if (field.type === 'number') {
    const value = Number(text);
    return Number.isFinite(value) ? { name: field.name, comparison_operator: row.operator, value } : null;
  }
  return { name: field.name, comparison_operator: row.operator, value: text };
}

/** Filter rows that `buildSearchRequest` drops because they are incomplete or no longer match a filterable field. */
export const droppedConditions = (settings: SearchSettings, fields: MetadataField[]) =>
  settings.conditions.filter(row => toCondition(row, fields) === null).length;

/** Omits unset optionals so the server keeps its defaults; drops incomplete filter rows. */
export function buildSearchRequest({ query, settings }: SearchState, fields: MetadataField[]): SearchRequest {
  const body: SearchRequest = {
    query: query.trim().slice(0, QUERY_MAX),
    top_k: settings.topK !== null && Number.isFinite(settings.topK) ? clamp(Math.round(settings.topK), 1, 20) : DEFAULT_TOP_K,
  };
  if (settings.scoreThreshold !== null) body.score_threshold = clamp(settings.scoreThreshold, 0, 1);
  if (settings.semanticWeight !== null) body.semantic_weight = clamp(settings.semanticWeight, 0, 1);
  if (settings.maxChunksPerDoc !== null && Number.isFinite(settings.maxChunksPerDoc)) {
    body.max_chunks_per_doc = clamp(Math.round(settings.maxChunksPerDoc), 1, 10);
  }
  const conditions = settings.conditions.map(row => toCondition(row, fields)).filter((item): item is Condition => item !== null)
    .slice(0, MAX_CONDITIONS);
  if (conditions.length > 0) body.metadata_condition = { logical_operator: settings.logicalOperator, conditions };
  return body;
}
