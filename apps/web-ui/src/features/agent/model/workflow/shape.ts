import type { ChatflowWorkflow } from '../../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Whether a draft `workflow` value has the shape the canvas and node form read from.
 * The JSON tabs accept any JSON object, so a half-typed workflow (no `nodes` array, a null node) can reach them.
 */
export function isRenderableWorkflow(value: unknown): value is ChatflowWorkflow {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return false;
  if (!value.nodes.every(node => isRecord(node) && typeof node.id === 'string' && typeof node.type === 'string')) return false;
  if (value.edges === undefined) return true;
  return Array.isArray(value.edges) && value.edges.every(edge =>
    isRecord(edge) && typeof edge.id === 'string' && typeof edge.source === 'string' && typeof edge.target === 'string');
}
