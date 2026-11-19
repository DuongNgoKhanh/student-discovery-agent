'use client';

import '@xyflow/react/dist/style.css';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeProps,
  type OnBeforeDelete,
  type OnConnect,
  type OnEdgesChange,
  type OnEdgesDelete,
  type OnNodeDrag,
  type OnNodesChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import { CircleAlert, LayoutGrid, Maximize, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ConfirmDialog } from '@/features/knowledge';
import { cn } from '@/lib/utils/cn';
import {
  addNode,
  deleteNode,
  generateNodeId,
  isValidIdentifier,
  MAX_WORKFLOW_EDGES,
  MAX_WORKFLOW_NODES,
  moveNode,
  removeEdge,
  setHandleEdge,
  WorkflowEditError,
} from '../model/workflow/edit';
import { validTargets } from '../model/workflow/graph';
import { handleLabel, isErrorHandle, nodeHandles, type NodeHandle } from '../model/workflow/handles';
import { parseWorkflowIssuePath, type WorkflowIssueTarget } from '../model/workflow/issue-path';
import { arrangeWorkflow, computeWorkflowLayout, type WorkflowLayoutOptions } from '../model/workflow/layout';
import { nodeSummary } from '../model/workflow/summary';
import type {
  AgentIssue,
  ChatflowNode,
  ChatflowNodeType,
  ChatflowWorkflow,
  NodeTypeCatalog,
  WorkflowNodeType,
} from '../types';
import { NodePalette, WORKFLOW_PALETTE_MIME } from './node-palette';
import { NodeIcon, nodeVisual } from './node-visuals';

export interface WorkflowCanvasProps {
  workflow: ChatflowWorkflow;
  catalog?: NodeTypeCatalog;
  issues?: AgentIssue[];
  readOnly?: boolean;
  showPalette?: boolean;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onChange?: (next: ChatflowWorkflow) => void;
  className?: string;
  /** Floats over the canvas (the node panel), so the graph keeps the full width. */
  overlay?: ReactNode;
  /** Node ids reached by a debug run, rendered as a highlighted path. */
  highlightedPath?: readonly string[];
  /** Node currently between workflow.node_started and workflow.node_finished. */
  activeNodeId?: string | null;
}

export interface WorkflowConnectionLike {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
}

interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  /** Catalog title, shown under a custom title so the kind of node stays readable. */
  typeTitle?: string;
  description?: string;
  summary: string[];
  handles: NodeHandle[];
  invalid: boolean;
  highlighted: boolean;
  active: boolean;
  readOnly: boolean;
  isEntry: boolean;
  selected: boolean;
  position: { x: number; y: number };
  onRequestDelete?: (nodeId: string) => void;
}

type CanvasNode = Node<WorkflowNodeData, 'workflow'>;

function catalogType(catalog: NodeTypeCatalog | undefined, node: ChatflowNode): WorkflowNodeType | undefined {
  return catalog?.node_types.find((item) => item.type === node.type);
}

function defaultConfigFromSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};

  const config: Record<string, unknown> = {};
  for (const [key, rawProp] of Object.entries(properties as Record<string, unknown>)) {
    if (rawProp && typeof rawProp === 'object' && !Array.isArray(rawProp) && 'default' in rawProp) {
      const defaultValue = (rawProp as { default?: unknown }).default;
      if (defaultValue !== undefined) {
        config[key] = structuredClone(defaultValue);
      }
    }
  }
  return config;
}

export function workflowCanvasTargets(workflow: ChatflowWorkflow, issues: AgentIssue[] = []): WorkflowIssueTarget[] {
  return issues.map((issue) => parseWorkflowIssuePath(issue.path, workflow));
}

/** Validates a candidate canvas edge against identifier, cycle, start-node, and edge-cap rules. */
export function isValidWorkflowConnection(
  workflow: ChatflowWorkflow,
  connection: WorkflowConnectionLike,
): boolean {
  const { source, target, sourceHandle } = connection;
  if (!source || !target || !sourceHandle || !isValidIdentifier(sourceHandle)) {
    return false;
  }
  if (!workflow.nodes.some((node) => node.id === source)) {
    return false;
  }

  const edges = workflow.edges ?? [];
  const allowedTargets = validTargets(workflow.nodes, edges, source);
  if (!allowedTargets.some((node) => node.id === target)) {
    return false;
  }

  const hasExistingHandleEdge = edges.some(
    (edge) => edge.source === source && edge.source_handle === sourceHandle,
  );
  if (edges.length >= MAX_WORKFLOW_EDGES && !hasExistingHandleEdge) {
    return false;
  }

  return true;
}

/** Applies a valid canvas connection to the workflow, creating or retargeting the handle's edge. */
export function connectWorkflowNodes(
  workflow: ChatflowWorkflow,
  connection: WorkflowConnectionLike,
): ChatflowWorkflow {
  if (!isValidWorkflowConnection(workflow, connection)) {
    return workflow;
  }
  return setHandleEdge(
    workflow,
    connection.source!,
    connection.sourceHandle!,
    connection.target!,
  );
}

/** Updates a node's `ui.position` in the workflow without altering other fields. */
export function moveWorkflowNode(
  workflow: ChatflowWorkflow,
  nodeId: string,
  position: { x: number; y: number },
): ChatflowWorkflow {
  return moveNode(workflow, nodeId, position);
}

/** Creates a new node of `type` with catalog defaults and adds it to the workflow. */
export function createNodeFromCatalog(
  workflow: ChatflowWorkflow,
  type: ChatflowNodeType,
  catalog?: NodeTypeCatalog,
  position?: { x: number; y: number },
): ChatflowWorkflow {
  const spec = catalog?.node_types.find((item) => item.type === type);
  const config = defaultConfigFromSchema(spec?.config_schema);
  const id = generateNodeId(workflow, type);
  const node: ChatflowNode = {
    id,
    type,
    ...(spec?.title ? { title: spec.title } : {}),
    ...(Object.keys(config).length > 0 ? { config } : {}),
    ...(position ? { ui: { position } } : {}),
  };
  return addNode(workflow, node);
}

// Card geometry, also fed to the auto layout so arranged cards do not overlap.
const CARD_WIDTH = 240;
const CARD_HEADER = 52;
const CARD_SUMMARY_LINE = 18;
const CARD_ROW = 24;

function estimatedCardHeight(summaryLines: number, handles: number): number {
  return CARD_HEADER + (summaryLines ? summaryLines * CARD_SUMMARY_LINE + 16 : 0) + handles * CARD_ROW + 12;
}

function WorkflowNode({ id, data }: NodeProps<CanvasNode>) {
  const { dot } = nodeVisual(data.nodeType);
  const ring = data.invalid
    ? 'border-destructive ring-2 ring-destructive/25'
    : data.active
      ? 'border-primary ring-2 ring-primary animate-pulse'
      : data.highlighted
        ? 'border-primary ring-2 ring-primary/20'
    : data.selected
      ? 'border-primary ring-2 ring-primary/25'
      : 'border-border hover:border-primary/40';

  return (
    <div
      data-testid={`workflow-node-${id}`}
      data-position={`${Math.round(data.position.x)},${Math.round(data.position.y)}`}
      title={data.description}
      style={{ width: CARD_WIDTH }}
      className={cn('group rounded-xl border bg-card pb-2 text-card-foreground shadow-sm transition-shadow hover:shadow-md', ring)}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={!data.readOnly && !data.isEntry}
        style={{ top: CARD_HEADER / 2 }}
        className={cn('!h-4 !w-1.5 !rounded-sm !border-0', data.isEntry ? '!opacity-0' : '!bg-muted-foreground/60')}
      />
      <div className="flex items-center gap-2.5 px-3 pt-3">
        <NodeIcon type={data.nodeType} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-13 font-semibold leading-tight">{data.label}</div>
          {data.typeTitle ? <div className="truncate text-[11px] leading-tight text-muted-foreground">{data.typeTitle}</div> : null}
        </div>
        {data.invalid ? <CircleAlert aria-label="Node có lỗi" className="size-4 shrink-0 text-destructive" /> : null}
        {!data.readOnly && !data.isEntry && data.onRequestDelete ? (
          <button
            type="button"
            className="nodrag nopan rounded-md p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`Xoá node ${data.label}`}
            data-testid={`delete-node-${id}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onRequestDelete?.(id);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      {data.summary.length ? (
        <div className="mx-3 mt-2 space-y-0.5 rounded-md bg-muted/70 px-2 py-1.5">
          {data.summary.map((line, index) => (
            <p key={index} className="truncate font-mono text-[11px] leading-[18px] text-muted-foreground">{line}</p>
          ))}
        </div>
      ) : null}
      {data.handles.length ? (
        <div className="mt-1.5">
          {data.handles.map((handle) => {
            const label = handleLabel(handle);
            return (
              <div
                key={handle.id}
                title={label === handle.id ? undefined : handle.id}
                className={cn(
                  'relative flex h-6 items-center justify-end px-3 text-[11px] font-medium',
                  isErrorHandle(handle) ? 'text-destructive/80' : 'text-foreground/70',
                )}
              >
                {label}
                {/* Positioned within its own row (default top: 50%), so the dot sits beside its label. */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={handle.id}
                  isConnectable={!data.readOnly}
                  className={cn('!size-2.5 !border-2 !border-card', isErrorHandle(handle) ? '!bg-destructive/70' : dot)}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CanvasToolbar({ onArrange }: { onArrange?: () => void }) {
  const flow = useReactFlow();
  const button =
    'rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div role="toolbar" aria-label="Điều khiển sơ đồ" className="flex items-center gap-0.5 rounded-xl border bg-card/95 p-1 shadow-md backdrop-blur">
      <button type="button" aria-label="Thu nhỏ" title="Thu nhỏ" className={button} onClick={() => void flow.zoomOut()}>
        <ZoomOut className="size-4" />
      </button>
      <button type="button" aria-label="Phóng to" title="Phóng to" className={button} onClick={() => void flow.zoomIn()}>
        <ZoomIn className="size-4" />
      </button>
      <button type="button" aria-label="Vừa khung" title="Vừa khung" className={button} onClick={() => void flow.fitView({ padding: 0.2 })}>
        <Maximize className="size-4" />
      </button>
      {onArrange ? (
        <>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          <button type="button" className={cn(button, 'flex items-center gap-1.5 px-2 text-xs font-medium')} onClick={onArrange}>
            <LayoutGrid className="size-4" /> Sắp xếp lại
          </button>
        </>
      ) : null}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNode };

/** Browser-only workflow canvas supporting read-only inspection and interactive graph editing. */
// A shared default: a fresh `[]` per render would rebuild every node and edge memo below.
const NO_PATH: readonly string[] = [];

export function WorkflowCanvas({
  workflow,
  catalog,
  issues = [],
  readOnly,
  showPalette = true,
  selectedNodeId,
  onSelectNode,
  onChange,
  className,
  overlay,
  highlightedPath = NO_PATH,
  activeNodeId = null,
}: WorkflowCanvasProps) {
  const isReadOnly = readOnly ?? !onChange;
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const dragPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const dragCommittedRef = useRef<Set<string>>(new Set());
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const activeSelectedNodeId = selectedNodeId !== undefined ? selectedNodeId : internalSelectedNodeId;

  const selectNode = useCallback(
    (nextId: string | null) => {
      if (selectedNodeId === undefined) {
        setInternalSelectedNodeId(nextId);
      }
      onSelectNode?.(nextId);
    },
    [onSelectNode, selectedNodeId],
  );

  const targets = useMemo(() => workflowCanvasTargets(workflow, issues), [workflow, issues]);
  const invalidNodes = useMemo(
    () => new Set(targets.filter((target) => target.kind === 'node').map((target) => target.nodeId)),
    [targets],
  );
  const invalidEdges = useMemo(
    () => new Set(targets.filter((target) => target.kind === 'edge').map((target) => target.edgeId)),
    [targets],
  );
  const highlightedNodes = useMemo(() => new Set(highlightedPath), [highlightedPath]);
  const highlightedEdges = useMemo(() => new Set(
    highlightedPath.slice(0, -1).map((source, index) => `${source}->${highlightedPath[index + 1]}`),
  ), [highlightedPath]);
  const cards = useMemo(
    () =>
      new Map(
        workflow.nodes.map((node) => {
          const type = catalogType(catalog, node);
          return [node.id, { type, handles: nodeHandles(node, type?.handles), summary: nodeSummary(node) }];
        }),
      ),
    [catalog, workflow.nodes],
  );
  const layoutOptions = useMemo<WorkflowLayoutOptions>(() => {
    let nodeHeight = 120;
    for (const card of cards.values()) {
      nodeHeight = Math.max(nodeHeight, estimatedCardHeight(card.summary.length, card.handles.length));
    }
    return {
      nodeWidth: CARD_WIDTH,
      nodeHeight,
      handleOrderByNode: Object.fromEntries([...cards].map(([id, card]) => [id, card.handles.map((handle) => handle.id)])),
    };
  }, [cards]);
  const positions = useMemo(() => computeWorkflowLayout(workflow, layoutOptions), [layoutOptions, workflow]);

  const requestDeleteNode = useCallback(
    (nodeId: string) => {
      if (isReadOnly) return;
      const target = workflow.nodes.find((node) => node.id === nodeId);
      if (!target || target.id === workflow.entry || target.type === 'start') return;
      setPendingDeleteId(nodeId);
    },
    [isReadOnly, workflow.entry, workflow.nodes],
  );

  const nodes = useMemo<CanvasNode[]>(
    () =>
      workflow.nodes.map((node) => {
        const card = cards.get(node.id);
        const type = card?.type;
        const pos = dragPositions[node.id] ?? positions[node.id] ?? { x: 40, y: 40 };
        const isEntry = node.id === workflow.entry || node.type === 'start';
        const isSelected = activeSelectedNodeId === node.id;
        return {
          id: node.id,
          type: 'workflow',
          position: pos,
          selected: isSelected,
          data: {
            label: node.title || type?.title || node.type,
            nodeType: node.type,
            typeTitle: node.title && type?.title && node.title !== type.title ? type.title : undefined,
            description: type?.description,
            summary: card?.summary ?? [],
            handles: card?.handles ?? [],
            invalid: invalidNodes.has(node.id),
            highlighted: highlightedNodes.has(node.id),
            active: activeNodeId === node.id,
            readOnly: isReadOnly,
            isEntry,
            selected: isSelected,
            position: pos,
            onRequestDelete: isReadOnly ? undefined : requestDeleteNode,
          },
          draggable: !isReadOnly,
          selectable: !isReadOnly,
        };
      }),
    [
      activeSelectedNodeId,
      cards,
      dragPositions,
      invalidNodes,
      isReadOnly,
      positions,
      requestDeleteNode,
      workflow.entry,
      workflow.nodes,
      activeNodeId,
      highlightedNodes,
    ],
  );

  const edges = useMemo<Edge[]>(
    () =>
      (workflow.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.source_handle || undefined,
        // Right-angle paths read more calmly than curves when many branches fan out.
        type: 'smoothstep',
        pathOptions: { borderRadius: 10, offset: 18 },
        selected: selectedEdgeIds.has(edge.id),
        animated: false,
        style: invalidEdges.has(edge.id)
          ? { stroke: 'hsl(var(--destructive))', strokeWidth: 2.5 }
          : highlightedEdges.has(`${edge.source}->${edge.target}`)
            ? { stroke: 'hsl(var(--primary))', strokeWidth: 3 }
          : selectedEdgeIds.has(edge.id)
            ? { stroke: 'hsl(var(--primary))', strokeWidth: 2 }
            : { stroke: 'hsl(var(--muted-foreground) / 0.45)', strokeWidth: 1.5 },
      })),
    [highlightedEdges, invalidEdges, selectedEdgeIds, workflow.edges],
  );

  // Edit helpers throw WorkflowEditError for graph rules; show it instead of an uncaught error in a DOM handler.
  const applyEdit = useCallback(
    (edit: () => ChatflowWorkflow): ChatflowWorkflow | null => {
      try {
        const next = edit();
        setEditError(null);
        return next;
      } catch (error) {
        if (!(error instanceof WorkflowEditError)) throw error;
        setEditError(`Không thực hiện được: ${error.message}`);
        return null;
      }
    },
    [],
  );

  const handleAddNode = useCallback(
    (type: ChatflowNodeType, position?: { x: number; y: number }) => {
      if (isReadOnly || workflow.nodes.length >= MAX_WORKFLOW_NODES) return;
      const next = applyEdit(() => createNodeFromCatalog(workflow, type, catalog, position));
      if (!next) return;
      const addedNode = next.nodes[next.nodes.length - 1];
      onChange?.(next);
      if (addedNode) {
        selectNode(addedNode.id);
      }
    },
    [applyEdit, catalog, isReadOnly, onChange, selectNode, workflow],
  );

  const handleArrange = useCallback(() => {
    if (isReadOnly) return;
    onChange?.(arrangeWorkflow(workflow, layoutOptions));
    // Let the moved cards render before framing them.
    requestAnimationFrame(() => void flowInstanceRef.current?.fitView({ padding: 0.2 }));
  }, [isReadOnly, layoutOptions, onChange, workflow]);

  const handleNodesChange: OnNodesChange<CanvasNode> = useCallback(
    (changes) => {
      if (selectedNodeId === undefined) {
        const selectChanges = changes.filter((change) => change.type === 'select');
        if (selectChanges.length > 0) {
          setInternalSelectedNodeId((current) => {
            let next = current;
            for (const change of selectChanges) {
              if (change.selected) {
                next = change.id;
              } else if (next === change.id) {
                next = null;
              }
            }
            return next;
          });
        }
      }

      const positionStarts: Record<string, { x: number; y: number }> = {};
      const clearedIds: string[] = [];
      let nextWorkflow = workflow;

      for (const change of changes) {
        if (change.type !== 'position') continue;

        if (change.dragging) {
          dragCommittedRef.current.delete(change.id);
          if (change.position) {
            positionStarts[change.id] = change.position;
          }
          continue;
        }

        clearedIds.push(change.id);
        if (isReadOnly) continue;

        const finalPosition = change.position ?? dragPositionsRef.current[change.id];
        if (
          change.dragging === false &&
          finalPosition &&
          Number.isFinite(finalPosition.x) &&
          Number.isFinite(finalPosition.y)
        ) {
          dragCommittedRef.current.add(change.id);
          queueMicrotask(() => dragCommittedRef.current.delete(change.id));
          nextWorkflow = moveWorkflowNode(nextWorkflow, change.id, finalPosition);
        }
      }

      if (Object.keys(positionStarts).length > 0 || clearedIds.length > 0) {
        setDragPositions((current) => {
          const updated = { ...current, ...positionStarts };
          for (const id of clearedIds) {
            if (!(id in positionStarts)) {
              delete updated[id];
            }
          }
          dragPositionsRef.current = updated;
          return updated;
        });
      }

      if (nextWorkflow !== workflow) {
        onChange?.(nextWorkflow);
      }
    },
    [isReadOnly, onChange, selectedNodeId, workflow],
  );

  const handleNodeDragStop: OnNodeDrag<CanvasNode> = useCallback(
    (_event, node, draggedNodes) => {
      if (isReadOnly) return;
      const targetsToCommit = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
      let nextWorkflow = workflow;
      const toClear: string[] = [];

      for (const dragged of targetsToCommit) {
        toClear.push(dragged.id);
        if (dragCommittedRef.current.has(dragged.id)) {
          dragCommittedRef.current.delete(dragged.id);
          continue;
        }
        if (Number.isFinite(dragged.position.x) && Number.isFinite(dragged.position.y)) {
          nextWorkflow = moveWorkflowNode(nextWorkflow, dragged.id, dragged.position);
        }
      }

      setDragPositions((current) => {
        const updated = { ...current };
        let changed = false;
        for (const id of toClear) {
          if (id in updated) {
            delete updated[id];
            changed = true;
          }
        }
        if (!changed) return current;
        dragPositionsRef.current = updated;
        return updated;
      });

      if (nextWorkflow !== workflow) {
        onChange?.(nextWorkflow);
      }
    },
    [isReadOnly, onChange, workflow],
  );

  const handleEdgesChange: OnEdgesChange = useCallback((changes) => {
    const selectChanges = changes.filter((change) => change.type === 'select');
    if (selectChanges.length === 0) return;
    setSelectedEdgeIds((current) => {
      const next = new Set(current);
      for (const change of selectChanges) {
        if (change.selected) {
          next.add(change.id);
        } else {
          next.delete(change.id);
        }
      }
      return next;
    });
  }, []);

  const handleIsValidConnection: IsValidConnection = useCallback(
    (connection) => !isReadOnly && isValidWorkflowConnection(workflow, connection),
    [isReadOnly, workflow],
  );

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (isReadOnly) return;
      const next = applyEdit(() => connectWorkflowNodes(workflow, connection));
      if (next && next !== workflow) {
        onChange?.(next);
      }
    },
    [applyEdit, isReadOnly, onChange, workflow],
  );

  const handleBeforeDelete: OnBeforeDelete<CanvasNode, Edge> = useCallback(
    async ({ nodes: nodesToDelete, edges: edgesToDelete }) => {
      if (isReadOnly) return false;
      if (nodesToDelete.length > 0) {
        const deletable = nodesToDelete.find(
          (node) => node.id !== workflow.entry && !node.data.isEntry,
        );
        if (deletable) {
          setPendingDeleteId(deletable.id);
        }
        return false;
      }
      return edgesToDelete.length > 0;
    },
    [isReadOnly, workflow.entry],
  );

  const handleEdgesDelete: OnEdgesDelete = useCallback(
    (edgesToDelete) => {
      if (isReadOnly) return;
      let next = workflow;
      for (const edge of edgesToDelete) {
        next = removeEdge(next, edge.id);
      }
      if (next !== workflow) {
        onChange?.(next);
      }
    },
    [isReadOnly, onChange, workflow],
  );

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isReadOnly) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (isReadOnly) return;
    event.preventDefault();
    const rawType = event.dataTransfer?.getData(WORKFLOW_PALETTE_MIME);
    if (!rawType || rawType === 'start' || !isValidIdentifier(rawType)) return;
    if (catalog && !catalog.node_types.some((item) => item.type === rawType)) return;

    const clientX = Number.isFinite(event.clientX) ? event.clientX : 0;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : 0;
    let position: { x: number; y: number } | undefined;
    if (flowInstanceRef.current) {
      const projected = flowInstanceRef.current.screenToFlowPosition({ x: clientX, y: clientY });
      if (Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
        position = { x: Math.round(projected.x), y: Math.round(projected.y) };
      }
    }
    if (!position) {
      const rect = event.currentTarget.getBoundingClientRect();
      position = {
        x: Math.round(clientX - rect.left),
        y: Math.round(clientY - rect.top),
      };
    }

    handleAddNode(rawType as ChatflowNodeType, position);
  };

  const pendingDeleteNode = pendingDeleteId
    ? workflow.nodes.find((node) => node.id === pendingDeleteId)
    : undefined;
  const pendingDeleteLabel = pendingDeleteNode
    ? pendingDeleteNode.title || catalogType(catalog, pendingDeleteNode)?.title || pendingDeleteNode.id
    : '';
  const connectedEdgeCount = pendingDeleteNode
    ? (workflow.edges ?? []).filter(
        (edge) => edge.source === pendingDeleteNode.id || edge.target === pendingDeleteNode.id,
      ).length
    : 0;

  return (
    <>
      <div
        className={cn('relative overflow-hidden rounded-xl border bg-muted/40', className ?? 'h-[520px] w-full')}
        data-testid="workflow-canvas"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          connectionLineType={ConnectionLineType.SmoothStep}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.25}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={!isReadOnly}
          nodesConnectable={!isReadOnly}
          elementsSelectable={!isReadOnly}
          edgesReconnectable={false}
          deleteKeyCode={isReadOnly ? null : ['Backspace', 'Delete']}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
          }}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onNodeDragStart={(_event, node) => {
            dragCommittedRef.current.delete(node.id);
          }}
          onNodeDragStop={handleNodeDragStop}
          isValidConnection={handleIsValidConnection}
          onConnect={handleConnect}
          onBeforeDelete={handleBeforeDelete}
          onEdgesDelete={handleEdgesDelete}
          onNodeClick={(_event, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="hsl(var(--muted-foreground) / 0.25)" />
          {!isReadOnly && showPalette ? (
            <Panel position="top-left">
              <NodePalette catalog={catalog} nodeCount={workflow.nodes.length} onAddNode={handleAddNode} />
            </Panel>
          ) : null}
          {editError ? (
            <Panel position="top-center">
              <p role="alert" className="rounded-lg border border-destructive/30 bg-card px-3 py-2 text-sm text-destructive shadow-md">
                {editError}
              </p>
            </Panel>
          ) : null}
          <Panel position="bottom-left">
            <CanvasToolbar onArrange={isReadOnly ? undefined : handleArrange} />
          </Panel>
        </ReactFlow>
        {overlay}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteNode)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        onConfirm={() => {
          if (!pendingDeleteNode || isReadOnly) return;
          const next = deleteNode(workflow, pendingDeleteNode.id);
          onChange?.(next);
          if (activeSelectedNodeId === pendingDeleteNode.id) {
            selectNode(null);
          }
          setPendingDeleteId(null);
        }}
        title="Xoá node?"
        description={
          connectedEdgeCount > 0
            ? `Xoá node "${pendingDeleteLabel}" và gỡ ${connectedEdgeCount} cạnh liên quan?`
            : `Xoá node "${pendingDeleteLabel}" khỏi workflow?`
        }
        confirmLabel="Xoá node"
        destructive
      />
    </>
  );
}
