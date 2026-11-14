'use client';

import '@xyflow/react/dist/style.css';
import {
  Background,
  Handle,
  Position,
  ReactFlow,
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
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { ConfirmDialog } from '@/features/knowledge';
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
} from '../model/workflow/edit';
import { validTargets } from '../model/workflow/graph';
import { parseWorkflowIssuePath, type WorkflowIssueTarget } from '../model/workflow/issue-path';
import { computeWorkflowLayout } from '../model/workflow/layout';
import type {
  AgentIssue,
  ChatflowNode,
  ChatflowNodeType,
  ChatflowWorkflow,
  NodeTypeCatalog,
  WorkflowHandleSpec,
  WorkflowNodeType,
} from '../types';
import { NodePalette, WORKFLOW_PALETTE_MIME } from './node-palette';

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
}

export interface WorkflowConnectionLike {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
}

interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  handles: string[];
  invalid: boolean;
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

function handleNames(node: ChatflowNode, spec: WorkflowHandleSpec | undefined): string[] {
  if (!spec) return [];
  const names = [...spec.static];
  const generated = spec.from_config;
  const config = node.config ?? {};
  const configured = generated ? config[generated.array] : undefined;
  const values: unknown[] = Array.isArray(configured) ? configured : [];
  if (generated) {
    for (const value of values) {
      const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
      if (item && typeof item[generated.id_field] === 'string') {
        names.push(item[generated.id_field] as string);
      }
    }
  }
  return [...new Set(names)];
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

function WorkflowNode({ id, data }: NodeProps<CanvasNode>) {
  const borderClass = data.invalid
    ? 'border-destructive ring-2 ring-destructive/30'
    : data.selected
      ? 'border-primary ring-2 ring-primary/30'
      : 'border-border';

  return (
    <div
      data-testid={`workflow-node-${id}`}
      data-position={`${Math.round(data.position.x)},${Math.round(data.position.y)}`}
      className={`min-w-48 rounded-md border bg-background px-3 py-2 shadow-sm ${borderClass}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={!data.readOnly && !data.isEntry}
        className="!h-2 !w-2"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{data.label}</div>
        {!data.readOnly && !data.isEntry && data.onRequestDelete ? (
          <button
            type="button"
            className="nodrag nopan rounded px-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Xoá node ${data.label}`}
            data-testid={`delete-node-${id}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onRequestDelete?.(id);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {data.description ? <div className="mt-1 text-xs text-muted-foreground">{data.description}</div> : null}
      {data.handles.map((handle, index) => (
        <div key={handle} className="relative mt-1 pr-2 text-right text-[11px] text-muted-foreground">
          {handle}
          <Handle
            type="source"
            position={Position.Right}
            id={handle}
            isConnectable={!data.readOnly}
            style={{ top: `${index * 20 + 12}px` }}
            className="!h-2 !w-2"
          />
        </div>
      ))}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNode };

/** Browser-only workflow canvas supporting read-only inspection and interactive graph editing. */
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
}: WorkflowCanvasProps) {
  const isReadOnly = readOnly ?? !onChange;
  const flowInstanceRef = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const dragPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const dragCommittedRef = useRef<Set<string>>(new Set());
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

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
  const handleOrderByNode = useMemo(
    () =>
      Object.fromEntries(
        workflow.nodes.map((node) => [node.id, handleNames(node, catalogType(catalog, node)?.handles)]),
      ),
    [catalog, workflow.nodes],
  );
  const positions = useMemo(
    () => computeWorkflowLayout(workflow, { handleOrderByNode }),
    [handleOrderByNode, workflow],
  );

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
        const type = catalogType(catalog, node);
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
            description: type?.description,
            handles: handleNames(node, type?.handles),
            invalid: invalidNodes.has(node.id),
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
      catalog,
      dragPositions,
      invalidNodes,
      isReadOnly,
      positions,
      requestDeleteNode,
      workflow.entry,
      workflow.nodes,
    ],
  );

  const edges = useMemo<Edge[]>(
    () =>
      (workflow.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.source_handle || undefined,
        selected: selectedEdgeIds.has(edge.id),
        animated: false,
        style: invalidEdges.has(edge.id) ? { stroke: 'hsl(var(--destructive))', strokeWidth: 3 } : undefined,
      })),
    [invalidEdges, selectedEdgeIds, workflow.edges],
  );

  const handleAddNode = useCallback(
    (type: ChatflowNodeType, position?: { x: number; y: number }) => {
      if (isReadOnly || workflow.nodes.length >= MAX_WORKFLOW_NODES) return;
      const next = createNodeFromCatalog(workflow, type, catalog, position);
      const addedNode = next.nodes[next.nodes.length - 1];
      onChange?.(next);
      if (addedNode) {
        selectNode(addedNode.id);
      }
    },
    [catalog, isReadOnly, onChange, selectNode, workflow],
  );

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
      const next = connectWorkflowNodes(workflow, connection);
      if (next !== workflow) {
        onChange?.(next);
      }
    },
    [isReadOnly, onChange, workflow],
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
    <div className="space-y-3">
      {!isReadOnly && showPalette ? (
        <NodePalette
          catalog={catalog}
          nodeCount={workflow.nodes.length}
          onAddNode={handleAddNode}
        />
      ) : null}
      <div
        className={className ?? 'h-[520px] w-full rounded-md border'}
        data-testid="workflow-canvas"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
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
          <Background />
        </ReactFlow>
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
    </div>
  );
}
