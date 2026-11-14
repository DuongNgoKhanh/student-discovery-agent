import type { ChatflowEdge, ChatflowNode, ChatflowWorkflow } from '../../types';
import { wouldCreateCycle } from './graph';

// Client-side pre-checks; keep in sync with the runtime source of truth in
// apps/agent-runtime/src/agent_runtime/sessions/schemas/workflow.py and workflow/validator.py.
export const MAX_WORKFLOW_NODES = 50;
export const MAX_WORKFLOW_EDGES = 100;
export const CHATFLOW_IDENTIFIER_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const RESERVED_NODE_IDS: ReadonlySet<string> = new Set(['sys', 'conv', 'profile', 'result']);

export type WorkflowEditErrorCode =
  | 'MAX_NODES'
  | 'MAX_EDGES'
  | 'INVALID_ID'
  | 'RESERVED_ID'
  | 'DUPLICATE_ID'
  | 'ENTRY_NODE'
  | 'NODE_NOT_FOUND'
  | 'INVALID_TARGET'
  | 'INVALID_POSITION'
  | 'HANDLE_OCCUPIED'
  | 'CYCLE_DETECTED';

export class WorkflowEditError extends Error {
  readonly code: WorkflowEditErrorCode;

  constructor(code: WorkflowEditErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowEditError';
    this.code = code;
  }
}

export function isValidIdentifier(id: string): boolean {
  return CHATFLOW_IDENTIFIER_RE.test(id);
}

function sanitizePrefix(raw: string | undefined, fallback: string): string {
  const normalized = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized || !/^[a-z]/.test(normalized)) {
    return fallback;
  }
  return normalized;
}

function nextUniqueId(
  existing: ReadonlySet<string>,
  prefix: string,
  reserved?: ReadonlySet<string>,
): string {
  for (let index = 1; ; index += 1) {
    const suffix = `_${index}`;
    const maxBaseLength = 40 - suffix.length;
    const base = prefix.slice(0, maxBaseLength).replace(/_+$/, '') || 'n';
    const candidate = `${base}${suffix}`;
    if (!existing.has(candidate) && !reserved?.has(candidate)) {
      return candidate;
    }
  }
}

/** Generates a unique valid identifier for a new node, avoiding existing and reserved IDs. */
export function generateNodeId(
  workflow: Pick<ChatflowWorkflow, 'nodes'>,
  prefix = 'node',
): string {
  const existing = new Set(workflow.nodes.map((node) => node.id));
  const base = sanitizePrefix(prefix, 'node');
  return nextUniqueId(existing, base, RESERVED_NODE_IDS);
}

/** Generates a unique valid identifier for a new edge, avoiding existing edge IDs. */
export function generateEdgeId(
  workflow: Pick<ChatflowWorkflow, 'edges'>,
  prefix = 'edge',
): string {
  const existing = new Set((workflow.edges ?? []).map((edge) => edge.id));
  const base = sanitizePrefix(prefix, 'edge');
  return nextUniqueId(existing, base);
}

/** Immutably adds a node to the workflow, enforcing ID format, reserved IDs, uniqueness, and max 50 nodes. */
export function addNode(workflow: ChatflowWorkflow, node: ChatflowNode): ChatflowWorkflow {
  if (workflow.nodes.length >= MAX_WORKFLOW_NODES) {
    throw new WorkflowEditError(
      'MAX_NODES',
      `Cannot add node: maximum of ${MAX_WORKFLOW_NODES} nodes reached`,
    );
  }
  if (!isValidIdentifier(node.id)) {
    throw new WorkflowEditError(
      'INVALID_ID',
      `Invalid node id "${node.id}": must match ${CHATFLOW_IDENTIFIER_RE.source}`,
    );
  }
  if (RESERVED_NODE_IDS.has(node.id)) {
    throw new WorkflowEditError(
      'RESERVED_ID',
      `Node id "${node.id}" is reserved and cannot be used`,
    );
  }
  if (workflow.nodes.some((existing) => existing.id === node.id)) {
    throw new WorkflowEditError('DUPLICATE_ID', `Duplicate node id "${node.id}"`);
  }

  return {
    ...workflow,
    nodes: [...workflow.nodes, node],
  };
}

/**
 * Immutably removes a node and all edges connected to it as source or target.
 * The `entry` node cannot be deleted: the runtime requires exactly one start node as entry.
 */
export function deleteNode(workflow: ChatflowWorkflow, nodeId: string): ChatflowWorkflow {
  if (nodeId === workflow.entry) {
    throw new WorkflowEditError('ENTRY_NODE', `Entry node "${nodeId}" cannot be deleted`);
  }

  const nextNodes = workflow.nodes.filter((node) => node.id !== nodeId);
  const currentEdges = workflow.edges ?? [];
  const nextEdges = currentEdges.filter(
    (edge) => edge.source !== nodeId && edge.target !== nodeId,
  );

  if (nextNodes.length === workflow.nodes.length && nextEdges.length === currentEdges.length) {
    return workflow;
  }

  return {
    ...workflow,
    nodes: nextNodes,
    ...(workflow.edges !== undefined ? { edges: nextEdges } : {}),
  };
}

/** Immutably updates only `ui.position` for the specified node, preserving all other fields. */
export function moveNode(
  workflow: ChatflowWorkflow,
  nodeId: string,
  position: { x: number; y: number },
): ChatflowWorkflow {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new WorkflowEditError('INVALID_POSITION', 'Node position coordinates must be finite numbers');
  }

  let changed = false;
  const nextNodes = workflow.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    changed = true;
    return {
      ...node,
      ui: {
        ...node.ui,
        position: { x: position.x, y: position.y },
      },
    };
  });

  if (!changed) return workflow;

  return {
    ...workflow,
    nodes: nextNodes,
  };
}

/** Immutably applies a partial update to a node while preserving its `id` and any unknown fields. */
export function updateNode(
  workflow: ChatflowWorkflow,
  nodeId: string,
  patch: Partial<Omit<ChatflowNode, 'id'>>,
): ChatflowWorkflow {
  let changed = false;
  const nextNodes = workflow.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    changed = true;
    return {
      ...node,
      ...patch,
      id: node.id,
    };
  });

  if (!changed) return workflow;

  return {
    ...workflow,
    nodes: nextNodes,
  };
}

export type AddEdgeInput = Omit<ChatflowEdge, 'id'> & { id?: string };

/**
 * Immutably adds an edge to the workflow, enforcing:
 * - max 100 edges
 * - valid source/target nodes and valid `source_handle` identifier
 * - no edges into a `start` node
 * - no self-loops or cycles
 * - at most one outgoing edge per `(source, source_handle)`
 * - unique valid edge `id` (auto-generated when omitted)
 */
export function addEdge(workflow: ChatflowWorkflow, edge: AddEdgeInput): ChatflowWorkflow {
  const currentEdges = workflow.edges ?? [];
  if (currentEdges.length >= MAX_WORKFLOW_EDGES) {
    throw new WorkflowEditError(
      'MAX_EDGES',
      `Cannot add edge: maximum of ${MAX_WORKFLOW_EDGES} edges reached`,
    );
  }

  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  if (!nodeIds.has(edge.source)) {
    throw new WorkflowEditError('NODE_NOT_FOUND', `Source node "${edge.source}" does not exist`);
  }
  const targetNode = workflow.nodes.find((node) => node.id === edge.target);
  if (!targetNode) {
    throw new WorkflowEditError('NODE_NOT_FOUND', `Target node "${edge.target}" does not exist`);
  }
  if (targetNode.type === 'start') {
    throw new WorkflowEditError(
      'INVALID_TARGET',
      `Edges cannot target start node "${edge.target}"`,
    );
  }
  if (!isValidIdentifier(edge.source_handle)) {
    throw new WorkflowEditError(
      'INVALID_ID',
      `Invalid source_handle "${edge.source_handle}": must match ${CHATFLOW_IDENTIFIER_RE.source}`,
    );
  }
  if (wouldCreateCycle(currentEdges, edge.source, edge.target)) {
    throw new WorkflowEditError(
      'CYCLE_DETECTED',
      `Adding edge "${edge.source}" -> "${edge.target}" would create a cycle`,
    );
  }
  if (
    currentEdges.some(
      (existing) =>
        existing.source === edge.source && existing.source_handle === edge.source_handle,
    )
  ) {
    throw new WorkflowEditError(
      'HANDLE_OCCUPIED',
      `Handle "${edge.source}.${edge.source_handle}" already has an outgoing edge`,
    );
  }

  const id =
    edge.id !== undefined
      ? edge.id
      : generateEdgeId(workflow, `e_${edge.source}_${edge.source_handle}`);

  if (!isValidIdentifier(id)) {
    throw new WorkflowEditError(
      'INVALID_ID',
      `Invalid edge id "${id}": must match ${CHATFLOW_IDENTIFIER_RE.source}`,
    );
  }
  if (currentEdges.some((existing) => existing.id === id)) {
    throw new WorkflowEditError('DUPLICATE_ID', `Duplicate edge id "${id}"`);
  }

  // Copy only contract fields: callers may pass React Flow connection objects, and the
  // runtime schema rejects extra edge fields.
  const nextEdge: ChatflowEdge = {
    id,
    source: edge.source,
    source_handle: edge.source_handle,
    target: edge.target,
  };

  return {
    ...workflow,
    edges: [...currentEdges, nextEdge],
  };
}

/** Immutably removes an edge by `id`. */
export function removeEdge(workflow: ChatflowWorkflow, edgeId: string): ChatflowWorkflow {
  const currentEdges = workflow.edges;
  if (!currentEdges) return workflow;

  const nextEdges = currentEdges.filter((edge) => edge.id !== edgeId);
  if (nextEdges.length === currentEdges.length) return workflow;

  return {
    ...workflow,
    edges: nextEdges,
  };
}

/**
 * Sets or clears the single outgoing edge for `(source, sourceHandle)`.
 * When `target` is null or empty, any existing edge on that handle is removed.
 * Retargeting keeps the existing edge's id and its position in `edges`, so layout order is stable.
 */
export function setHandleEdge(
  workflow: ChatflowWorkflow,
  source: string,
  sourceHandle: string,
  target: string | null,
): ChatflowWorkflow {
  if (!workflow.nodes.some((node) => node.id === source)) {
    throw new WorkflowEditError('NODE_NOT_FOUND', `Source node "${source}" does not exist`);
  }
  if (!isValidIdentifier(sourceHandle)) {
    throw new WorkflowEditError(
      'INVALID_ID',
      `Invalid source_handle "${sourceHandle}": must match ${CHATFLOW_IDENTIFIER_RE.source}`,
    );
  }

  const currentEdges = workflow.edges ?? [];
  const existingIndex = currentEdges.findIndex(
    (edge) => edge.source === source && edge.source_handle === sourceHandle,
  );
  const existing = currentEdges[existingIndex];
  if (existing && existing.target === target) return workflow;

  const withoutHandle: ChatflowWorkflow = existing
    ? {
        ...workflow,
        edges: currentEdges.filter((_, index) => index !== existingIndex),
      }
    : workflow;

  if (!target) {
    return withoutHandle;
  }

  // addEdge runs every invariant check and throws before anything is returned.
  const added = addEdge(withoutHandle, {
    ...(existing ? { id: existing.id } : {}),
    source,
    source_handle: sourceHandle,
    target,
  });
  if (!existing) return added;

  const retargeted = added.edges![added.edges!.length - 1]!;
  return {
    ...added,
    edges: currentEdges.map((edge, index) => (index === existingIndex ? retargeted : edge)),
  };
}
