import type { ChatflowEdge, ChatflowNode, ChatflowWorkflow } from '../../types';

export interface WorkflowPosition {
  x: number;
  y: number;
}

export interface WorkflowLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  layerGap?: number;
  nodeGap?: number;
  origin?: WorkflowPosition;
  /** Optional ordered outgoing handle names per node ID (e.g. from catalog static + from_config). */
  handleOrderByNode?: Record<string, readonly string[]>;
}

const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 120;
const DEFAULT_LAYER_GAP = 100;
const DEFAULT_NODE_GAP = 48;
const DEFAULT_ORIGIN: WorkflowPosition = { x: 40, y: 40 };

function hasValidPosition(node: ChatflowNode): node is ChatflowNode & { ui: { position: WorkflowPosition } } {
  const pos = node.ui?.position;
  return Boolean(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y));
}

function getHandleRank(
  edge: ChatflowEdge,
  edgeIndex: number,
  handleOrderByNode?: Record<string, readonly string[]>,
): number {
  const order = handleOrderByNode?.[edge.source];
  if (!order) return edgeIndex;
  const idx = order.indexOf(edge.source_handle);
  return idx >= 0 ? idx : order.length + edgeIndex;
}

function boxesOverlap(
  a: WorkflowPosition,
  b: WorkflowPosition,
  width: number,
  height: number,
): boolean {
  return Math.abs(a.x - b.x) < width && Math.abs(a.y - b.y) < height;
}

/**
 * Computes deterministic `{ x, y }` positions for all workflow nodes.
 * - Nodes with a finite `ui.position` keep their existing position.
 * - Reachable nodes from `entry` are layered by longest path and ordered within each layer by handle order.
 * - Unreachable nodes are placed in an extra layer after the deepest reachable layer.
 * - Auto-laid-out nodes are shifted if needed so they never overlap fixed nodes or each other.
 */
export function computeWorkflowLayout(
  workflow: Pick<ChatflowWorkflow, 'entry' | 'nodes' | 'edges'>,
  options: WorkflowLayoutOptions = {},
): Record<string, WorkflowPosition> {
  const nodes = workflow.nodes;
  if (nodes.length === 0) return {};

  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const layerGap = options.layerGap ?? DEFAULT_LAYER_GAP;
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const handleOrderByNode = options.handleOrderByNode;

  const nodeIndexById = new Map<string, number>();
  nodes.forEach((node, index) => {
    nodeIndexById.set(node.id, index);
  });

  // Build adjacency lists restricted to existing nodes, sorted by handle order.
  const outgoing = new Map<string, Array<{ edge: ChatflowEdge; index: number; rank: number }>>();
  const incoming = new Map<string, Array<{ edge: ChatflowEdge; index: number; rank: number }>>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  (workflow.edges ?? []).forEach((edge, index) => {
    if (!nodeIndexById.has(edge.source) || !nodeIndexById.has(edge.target)) return;
    if (edge.source === edge.target) return;
    const rank = getHandleRank(edge, index, handleOrderByNode);
    const entry = { edge, index, rank };
    outgoing.get(edge.source)!.push(entry);
    incoming.get(edge.target)!.push(entry);
  });

  for (const list of outgoing.values()) {
    list.sort((a, b) => a.rank - b.rank || a.index - b.index);
  }

  // 1. Discover reachable nodes from `entry` via BFS following handle-ordered outgoing edges.
  const reachable = new Set<string>();
  const bfsOrder: string[] = [];
  if (nodeIndexById.has(workflow.entry)) {
    const queue: string[] = [workflow.entry];
    reachable.add(workflow.entry);
    while (queue.length > 0) {
      const current = queue.shift()!;
      bfsOrder.push(current);
      for (const { edge } of outgoing.get(current)!) {
        if (!reachable.has(edge.target)) {
          reachable.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
  }

  // 2. Compute longest-path layer for reachable nodes (cycle-safe via Kahn + fallback).
  const layerById = new Map<string, number>();
  if (reachable.size > 0) {
    const inDegree = new Map<string, number>();
    for (const id of reachable) {
      let deg = 0;
      for (const { edge } of incoming.get(id)!) {
        if (reachable.has(edge.source)) deg += 1;
      }
      inDegree.set(id, deg);
      layerById.set(id, id === workflow.entry ? 0 : 0);
    }

    const ready: string[] = [];
    for (const id of bfsOrder) {
      if (inDegree.get(id) === 0) ready.push(id);
    }

    const processed = new Set<string>();
    while (ready.length > 0) {
      const u = ready.shift()!;
      processed.add(u);
      const uLayer = layerById.get(u) ?? 0;
      for (const { edge } of outgoing.get(u)!) {
        const v = edge.target;
        if (!reachable.has(v)) continue;
        const candidate = uLayer + 1;
        if (candidate > (layerById.get(v) ?? 0)) {
          layerById.set(v, candidate);
        }
        const nextDeg = (inDegree.get(v) ?? 0) - 1;
        inDegree.set(v, nextDeg);
        if (nextDeg === 0) ready.push(v);
      }
    }

    // Fallback for any nodes stuck in a pre-existing cycle.
    if (processed.size < reachable.size) {
      for (const id of bfsOrder) {
        if (processed.has(id)) continue;
        let maxParentLayer = -1;
        for (const { edge } of incoming.get(id)!) {
          if (processed.has(edge.source)) {
            maxParentLayer = Math.max(maxParentLayer, layerById.get(edge.source) ?? 0);
          }
        }
        layerById.set(id, maxParentLayer + 1);
        processed.add(id);
      }
    }
  }

  let maxReachableLayer = -1;
  for (const layer of layerById.values()) {
    if (layer > maxReachableLayer) maxReachableLayer = layer;
  }

  // 3. Place unreachable nodes in an extra layer.
  const extraLayer = maxReachableLayer + 1;
  for (const node of nodes) {
    if (!layerById.has(node.id)) {
      layerById.set(node.id, extraLayer);
    }
  }

  // 4. Group nodes by layer and sort within each layer by parent order + handle order.
  const maxLayer = Math.max(...layerById.values());
  const nodesByLayer = new Map<number, string[]>();
  for (let l = 0; l <= maxLayer; l += 1) {
    nodesByLayer.set(l, []);
  }
  for (const node of nodes) {
    const layer = layerById.get(node.id)!;
    nodesByLayer.get(layer)!.push(node.id);
  }

  const orderInLayer = new Map<string, number>();
  for (let l = 0; l <= maxLayer; l += 1) {
    const ids = nodesByLayer.get(l)!;
    if (l > 0) {
      ids.sort((aId, bId) => {
        const aKey = bestParentSortKey(aId, l, incoming, layerById, orderInLayer, nodeIndexById);
        const bKey = bestParentSortKey(bId, l, incoming, layerById, orderInLayer, nodeIndexById);
        return (
          aKey.parentOrder - bKey.parentOrder ||
          aKey.handleRank - bKey.handleRank ||
          aKey.edgeIndex - bKey.edgeIndex ||
          aKey.nodeIndex - bKey.nodeIndex
        );
      });
    }
    ids.forEach((id, idx) => {
      orderInLayer.set(id, idx);
    });
  }

  // 5. Assign positions: keep existing `ui.position` first, then place remaining nodes without overlap.
  const positions: Record<string, WorkflowPosition> = {};
  const placedBoxes: WorkflowPosition[] = [];

  for (const node of nodes) {
    if (hasValidPosition(node)) {
      const pos = { x: node.ui.position.x, y: node.ui.position.y };
      positions[node.id] = pos;
      placedBoxes.push(pos);
    }
  }

  const xStep = nodeWidth + layerGap;
  const yStep = nodeHeight + nodeGap;

  for (let l = 0; l <= maxLayer; l += 1) {
    const ids = nodesByLayer.get(l)!;
    ids.forEach((id, idx) => {
      if (positions[id]) return;
      const x = origin.x + l * xStep;
      let y = origin.y + idx * yStep;

      while (placedBoxes.some((box) => boxesOverlap({ x, y }, box, nodeWidth, nodeHeight))) {
        y += yStep;
      }

      const pos = { x, y };
      positions[id] = pos;
      placedBoxes.push(pos);
    });
  }

  return positions;
}

interface ParentSortKey {
  parentOrder: number;
  handleRank: number;
  edgeIndex: number;
  nodeIndex: number;
}

function bestParentSortKey(
  nodeId: string,
  layer: number,
  incoming: Map<string, Array<{ edge: ChatflowEdge; index: number; rank: number }>>,
  layerById: Map<string, number>,
  orderInLayer: Map<string, number>,
  nodeIndexById: Map<string, number>,
): ParentSortKey {
  const nodeIndex = nodeIndexById.get(nodeId) ?? Number.MAX_SAFE_INTEGER;
  let best: ParentSortKey | null = null;

  for (const { edge, index, rank } of incoming.get(nodeId) ?? []) {
    const parentLayer = layerById.get(edge.source);
    if (parentLayer === undefined || parentLayer >= layer) continue;
    const parentOrder = orderInLayer.get(edge.source) ?? Number.MAX_SAFE_INTEGER;
    const candidate: ParentSortKey = {
      parentOrder,
      handleRank: rank,
      edgeIndex: index,
      nodeIndex,
    };
    if (
      !best ||
      candidate.parentOrder < best.parentOrder ||
      (candidate.parentOrder === best.parentOrder &&
        (candidate.handleRank < best.handleRank ||
          (candidate.handleRank === best.handleRank && candidate.edgeIndex < best.edgeIndex)))
    ) {
      best = candidate;
    }
  }

  return (
    best ?? {
      parentOrder: Number.MAX_SAFE_INTEGER,
      handleRank: Number.MAX_SAFE_INTEGER,
      edgeIndex: Number.MAX_SAFE_INTEGER,
      nodeIndex,
    }
  );
}
