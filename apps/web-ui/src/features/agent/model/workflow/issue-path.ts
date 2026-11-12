import { parsePath, type Path } from '../config';
import type { ChatflowWorkflow } from '../../types';

export type WorkflowIssueTarget =
  | { kind: 'workflow'; configPath?: Path }
  | { kind: 'node'; nodeId: string; nodeIndex: number; configPath: Path }
  | { kind: 'edge'; edgeId: string; edgeIndex: number; configPath: Path }
  | { kind: 'variable'; variableIndex: number; variableName?: string; configPath: Path };

const workflowTarget = (): WorkflowIssueTarget => ({ kind: 'workflow' });

/** Maps a validator path to the workflow object it should highlight or focus. */
export function parseWorkflowIssuePath(
  path: string,
  workflow: ChatflowWorkflow,
): WorkflowIssueTarget {
  const parts = parsePath(path);
  if (parts[0] !== 'workflow' || typeof parts[1] !== 'string') return workflowTarget();

  const collection = parts[1];
  if (collection === 'entry' && parts.length === 2)
    return { kind: 'workflow', configPath: ['entry'] };
  if (collection === 'budget') return { kind: 'workflow', configPath: parts.slice(1) };

  const index = parts[2];
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return workflowTarget();

  if (collection === 'nodes') {
    const node = Array.isArray(workflow?.nodes) ? workflow.nodes[index] : undefined;
    if (!node || typeof node.id !== 'string' || !node.id) return workflowTarget();
    const remainder = parts.slice(3);
    return {
      kind: 'node',
      nodeId: node.id,
      nodeIndex: index,
      configPath: remainder[0] === 'config' ? remainder.slice(1) : remainder,
    };
  }

  if (collection === 'edges') {
    const edge = Array.isArray(workflow?.edges) ? workflow.edges[index] : undefined;
    if (!edge || typeof edge.id !== 'string' || !edge.id) return workflowTarget();
    return { kind: 'edge', edgeId: edge.id, edgeIndex: index, configPath: parts.slice(3) };
  }

  if (collection === 'variables') {
    const variable = Array.isArray(workflow?.variables) ? workflow.variables[index] : undefined;
    if (!variable) return workflowTarget();
    return {
      kind: 'variable',
      variableIndex: index,
      variableName: typeof variable.name === 'string' ? variable.name : undefined,
      configPath: parts.slice(3),
    };
  }

  return workflowTarget();
}
