'use client';

import '@xyflow/react/dist/style.css';
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useMemo } from 'react';
import { computeWorkflowLayout } from '../model/workflow/layout';
import { parseWorkflowIssuePath, type WorkflowIssueTarget } from '../model/workflow/issue-path';
import type {
  AgentIssue,
  ChatflowNode,
  ChatflowWorkflow,
  NodeTypeCatalog,
  WorkflowHandleSpec,
  WorkflowNodeType,
} from '../types';

export interface WorkflowCanvasProps {
  workflow: ChatflowWorkflow;
  catalog?: NodeTypeCatalog;
  issues?: AgentIssue[];
  readOnly?: boolean;
  className?: string;
}

interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  handles: string[];
  invalid: boolean;
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
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
      if (item && typeof item[generated.id_field] === 'string') {
        names.push(item[generated.id_field] as string);
      }
    }
  }
  return [...new Set(names)];
}

export function workflowCanvasTargets(workflow: ChatflowWorkflow, issues: AgentIssue[] = []): WorkflowIssueTarget[] {
  return issues.map((issue) => parseWorkflowIssuePath(issue.path, workflow));
}

function WorkflowNode({ data }: NodeProps<CanvasNode>) {
  return (
    <div className={`min-w-48 rounded-md border bg-background px-3 py-2 shadow-sm ${data.invalid ? 'border-destructive ring-2 ring-destructive/30' : 'border-border'}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <div className="text-sm font-medium">{data.label}</div>
      {data.description ? <div className="mt-1 text-xs text-muted-foreground">{data.description}</div> : null}
      {data.handles.map((handle, index) => (
        <div key={handle} className="relative mt-1 pr-2 text-right text-[11px] text-muted-foreground">
          {handle}
          <Handle type="source" position={Position.Right} id={handle} style={{ top: `${index * 20 + 12}px` }} className="!h-2 !w-2" />
        </div>
      ))}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNode };

/** Browser-only read-only workflow canvas. Mutations are deliberately added in T22-T6. */
export function WorkflowCanvas({ workflow, catalog, issues = [], readOnly = true, className }: WorkflowCanvasProps) {
  const targets = useMemo(() => workflowCanvasTargets(workflow, issues), [workflow, issues]);
  const invalidNodes = useMemo(() => new Set(targets.filter((target) => target.kind === 'node').map((target) => target.nodeId)), [targets]);
  const invalidEdges = useMemo(() => new Set(targets.filter((target) => target.kind === 'edge').map((target) => target.edgeId)), [targets]);
  const handleOrderByNode = useMemo(() => Object.fromEntries(workflow.nodes.map((node) => [node.id, handleNames(node, catalogType(catalog, node)?.handles)])), [catalog, workflow.nodes]);
  const positions = useMemo(() => computeWorkflowLayout(workflow, { handleOrderByNode }), [handleOrderByNode, workflow]);

  const nodes = useMemo<CanvasNode[]>(() => workflow.nodes.map((node) => {
    const type = catalogType(catalog, node);
    return {
      id: node.id,
      type: 'workflow',
      position: positions[node.id] ?? { x: 40, y: 40 },
      data: {
        label: node.title || type?.title || node.type,
        description: type?.description,
        handles: handleNames(node, type?.handles),
        invalid: invalidNodes.has(node.id),
      },
      draggable: !readOnly,
      selectable: !readOnly,
    };
  }), [catalog, invalidNodes, positions, readOnly, workflow.nodes]);

  const edges = useMemo<Edge[]>(() => (workflow.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.source_handle || undefined,
    animated: false,
    style: invalidEdges.has(edge.id) ? { stroke: 'hsl(var(--destructive))', strokeWidth: 3 } : undefined,
  })), [invalidEdges, workflow.edges]);

  return (
    <div className={className ?? 'h-[520px] w-full rounded-md border'} data-testid="workflow-canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable={!readOnly}>
        <Background />
      </ReactFlow>
    </div>
  );
}
