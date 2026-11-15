/**
 * Row model for the if_else condition builder, over the runtime's JSONLogic subset (agent_runtime/workflow/expressions.py).
 * Only a flat list of comparisons joined by one and/or maps to rows; anything else (nesting, `!`) stays JSON.
 */

export const CONDITION_OPERATORS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'missing'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  '==': 'bằng',
  '!=': 'khác',
  '<': 'nhỏ hơn',
  '<=': 'nhỏ hơn hoặc bằng',
  '>': 'lớn hơn',
  '>=': 'lớn hơn hoặc bằng',
  in: 'thuộc',
  missing: 'chưa có giá trị',
};

export interface ConditionRow {
  variable: string;
  operator: ConditionOperator;
  /** A literal as typed, `{{ns.name}}` for a variable, or a comma list for `in`. */
  value: string;
}

export interface ConditionRows {
  logic: 'and' | 'or';
  rows: ConditionRow[];
}

export const VARIABLE_PATH = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const VAR_REF = /^\{\{\s*([^{}\s]+)\s*\}\}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function single(raw: Record<string, unknown>): [string, unknown] | null {
  const keys = Object.keys(raw);
  return keys.length === 1 ? [keys[0]!, raw[keys[0]!]] : null;
}

function varPath(operand: unknown): string | null {
  if (!isRecord(operand)) return null;
  const entry = single(operand);
  if (!entry || entry[0] !== 'var') return null;
  const path = Array.isArray(entry[1]) && entry[1].length === 1 ? entry[1][0] : entry[1];
  return typeof path === 'string' ? path : null;
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    // A string that would read back as another JSON value is shown quoted, so the round trip keeps it a string.
    try {
      return typeof JSON.parse(value) === 'string' ? value : JSON.stringify(value);
    } catch {
      return value;
    }
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  return null;
}

function operandText(operand: unknown, operator: ConditionOperator): string | null {
  const path = varPath(operand);
  if (path !== null) return `{{${path}}}`;
  if (operator === 'in' && Array.isArray(operand)) {
    const items = operand.map(scalarText);
    return items.every((item): item is string => item !== null) ? items.join(', ') : null;
  }
  return isRecord(operand) || Array.isArray(operand) ? null : scalarText(operand);
}

function toRow(raw: unknown): ConditionRow | null {
  if (!isRecord(raw)) return null;
  const entry = single(raw);
  if (!entry) return null;
  const [operator, args] = entry;
  if (operator === 'missing') {
    const items = Array.isArray(args) ? args : [args];
    return items.length === 1 && typeof items[0] === 'string' ? { variable: items[0], operator, value: '' } : null;
  }
  if (!(CONDITION_OPERATORS as readonly string[]).includes(operator) || !Array.isArray(args) || args.length !== 2) {
    return null;
  }
  const variable = varPath(args[0]);
  const value = operandText(args[1], operator as ConditionOperator);
  return variable !== null && value !== null ? { variable, operator: operator as ConditionOperator, value } : null;
}

/** Rows for a stored condition, or null when it needs the JSON editor. An absent or empty condition is no rows. */
export function conditionToRows(raw: unknown): ConditionRows | null {
  if (raw === undefined || raw === null || (isRecord(raw) && Object.keys(raw).length === 0)) {
    return { logic: 'and', rows: [] };
  }
  if (!isRecord(raw)) return null;
  const entry = single(raw);
  if (entry && (entry[0] === 'and' || entry[0] === 'or') && Array.isArray(entry[1])) {
    const rows = entry[1].map(toRow);
    return rows.every((row): row is ConditionRow => row !== null) && rows.length > 0
      ? { logic: entry[0], rows }
      : null;
  }
  const row = toRow(raw);
  return row ? { logic: 'and', rows: [row] } : null;
}

function parseScalar(text: string): unknown {
  const trimmed = text.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed)) return parsed;
  } catch {
    // Not JSON: the text itself is the string.
  }
  return trimmed;
}

function parseOperand(text: string, operator: ConditionOperator): unknown {
  const ref = VAR_REF.exec(text.trim());
  if (ref) return { var: ref[1] };
  if (operator === 'in') {
    return text.split(',').map((item) => item.trim()).filter(Boolean).map(parseScalar);
  }
  return parseScalar(text);
}

function fromRow(row: ConditionRow): Record<string, unknown> {
  if (row.operator === 'missing') return { missing: [row.variable] };
  return { [row.operator]: [{ var: row.variable }, parseOperand(row.value, row.operator)] };
}

/** JSONLogic for the rows: one comparison stays bare, several are wrapped in the chosen and/or. */
export function rowsToCondition({ logic, rows }: ConditionRows): Record<string, unknown> {
  if (rows.length === 0) return {};
  if (rows.length === 1) return fromRow(rows[0]!);
  return { [logic]: rows.map(fromRow) };
}

function formatOperand(operand: unknown): string {
  const path = varPath(operand);
  if (path !== null) return path;
  if (Array.isArray(operand)) return `[${operand.map(formatOperand).join(', ')}]`;
  if (typeof operand === 'string') return `"${operand}"`;
  if (isRecord(operand)) return `(${formatCondition(operand)})`;
  return JSON.stringify(operand) ?? '';
}

/** One-line reading of a condition for the canvas card, e.g. `sys.turn_index == 0 và conv.step != "done"`. */
export function formatCondition(raw: unknown): string {
  if (!isRecord(raw)) return '';
  const entry = single(raw);
  if (!entry) return Object.keys(raw).length ? JSON.stringify(raw) : '';
  const [operator, args] = entry;
  const items = Array.isArray(args) ? args : [args];
  if (operator === 'and' || operator === 'or') {
    const parts = items.map((item) => {
      const nested = isRecord(item) ? single(item)?.[0] : undefined;
      return nested === 'and' || nested === 'or' ? `(${formatCondition(item)})` : formatCondition(item);
    });
    return parts.join(operator === 'and' ? ' và ' : ' hoặc ');
  }
  if (operator === 'missing') return `${items.join(', ')} chưa có giá trị`;
  if (operator === '!') return `không ${formatOperand(items[0])}`;
  if (operator === 'var') return formatOperand(raw);
  if (items.length === 2) return `${formatOperand(items[0])} ${operator} ${formatOperand(items[1])}`;
  return JSON.stringify(raw);
}
