import type { ChatflowNode } from '../../types';
import { formatCondition } from './condition';

const MAX_LINE = 72;
const MAX_LINES = 3;

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_LINE ? `${oneLine.slice(0, MAX_LINE - 1)}…` : oneLine;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value ?? null);
}

function assignmentLine(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { variable, operation = 'set', value } = raw as Record<string, unknown>;
  if (typeof variable !== 'string') return undefined;
  if (operation === 'clear') return `xoá ${variable}`;
  if (operation === 'append' || operation === 'add') return `${variable} += ${valueText(value)}`;
  return `${variable} = ${valueText(value)}`;
}

/** What a node does, in at most three short lines for its canvas card; empty when there is nothing set yet. */
export function nodeSummary(node: ChatflowNode): string[] {
  const config = node.config ?? {};
  const lines: Array<string | undefined> = [];
  switch (node.type) {
    case 'if_else':
      lines.push(formatCondition(config.condition) || undefined);
      break;
    case 'intent_classifier':
      lines.push(`Đầu vào ${text(config.input) ?? '{{sys.query}}'}`);
      break;
    case 'llm':
      lines.push(text(config.prompt), config.output === 'json' ? 'Output JSON' : undefined);
      break;
    case 'agent': {
      const tools = strings(config.tools);
      lines.push(tools.length ? `Tool: ${tools.join(', ')}` : 'Chưa chọn tool', text(config.instructions));
      break;
    }
    case 'knowledge_retrieval':
      lines.push(
        text(config.knowledge_base_id) ? `KB ${config.knowledge_base_id as string}` : 'Chưa chọn knowledge base',
        text(config.query),
      );
      break;
    case 'tool':
      lines.push(text(config.tool) ?? 'Chưa chọn tool');
      break;
    case 'profile_propose': {
      const fields = strings(config.fields);
      lines.push(fields.length ? `Trường: ${fields.join(', ')}` : undefined);
      break;
    }
    case 'assign':
      lines.push(...(Array.isArray(config.assignments) ? config.assignments.map(assignmentLine) : []));
      break;
    case 'answer': {
      const blocks = Array.isArray(config.blocks) ? config.blocks.length : 0;
      lines.push(text(config.text), blocks ? `${blocks} block` : undefined);
      break;
    }
  }
  return lines.filter((line): line is string => Boolean(line)).slice(0, MAX_LINES).map(clip);
}
