import type { ChatflowEdge, ChatflowNode } from '../../types';

export type GraphEdge = Pick<ChatflowEdge, 'source' | 'target'>;

/** Returns the set of all ancestor node IDs that can reach `nodeId` via directed edges. */
export function ancestorsOf(edges: readonly GraphEdge[], nodeId: string): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target);
    if (sources) {
      sources.push(edge.source);
    } else {
      incoming.set(edge.target, [edge.source]);
    }
  }

  const visited = new Set<string>();
  const queue: string[] = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const parents = incoming.get(current);
    if (!parents) continue;
    for (const parent of parents) {
      if (!visited.has(parent)) {
        visited.add(parent);
        queue.push(parent);
      }
    }
  }
  return visited;
}

/** Returns true if adding `source -> target` would form a self-loop or cycle. */
export function wouldCreateCycle(
  edges: readonly GraphEdge[],
  source: string,
  target: string,
): boolean {
  if (!source || !target) return false;
  if (source === target) return true;
  return ancestorsOf(edges, source).has(target);
}

/**
 * Returns nodes from `nodes` that `sourceId` can connect to without creating a self-loop or cycle.
 * `start` nodes are excluded because the runtime validator rejects edges into them.
 */
export function validTargets<T extends Pick<ChatflowNode, 'id' | 'type'>>(
  nodes: readonly T[],
  edges: readonly GraphEdge[],
  sourceId: string,
): T[] {
  const blocked = ancestorsOf(edges, sourceId);
  blocked.add(sourceId);
  return nodes.filter((node) => node.type !== 'start' && !blocked.has(node.id));
}
