'use client';

import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { removeEdge, setHandleEdge, updateNode, WorkflowEditError } from '../model/workflow/edit';
import { validTargets } from '../model/workflow/graph';
import { handleLabel, isErrorHandle, nodeHandles } from '../model/workflow/handles';
import { readableVariables } from '../model/workflow/variables';
import type { ChatflowWorkflow, NodeTypeCatalog } from '../types';
import { NodeField, type SchemaProperty } from './node-fields';
import { NodeIcon, nodeVisual } from './node-visuals';

export interface NodeFormProps {
  workflow: ChatflowWorkflow;
  nodeId: string;
  catalog?: NodeTypeCatalog;
  readOnly?: boolean;
  onChange?: (next: ChatflowWorkflow) => void;
  /** Reports a field holding invalid JSON (or null), so the caller can block saving and leaving. */
  onValidity?: (error: string | null) => void;
  onClose?: () => void;
}

function schemaProperties(schema: Record<string, unknown> | undefined): Array<[string, SchemaProperty]> {
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.entries(properties).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value) ? [[key, value as SchemaProperty] as [string, SchemaProperty]] : [],
  );
}

function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <section className="space-y-3 border-t px-4 py-4">
      <h4 className={cn('text-xs font-semibold text-muted-foreground', tone === 'danger' && 'text-destructive')}>{title}</h4>
      {children}
    </section>
  );
}

export function NodeForm({ workflow, nodeId, catalog, readOnly = false, onChange, onValidity, onClose }: NodeFormProps) {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [routingError, setRoutingError] = useState<string | null>(null);
  const firstError = Object.values(fieldErrors)[0] ?? null;
  const onValidityRef = useRef(onValidity);
  onValidityRef.current = onValidity;
  // A broken field holds text the workflow lacks: the page blocks saving and leaving until it parses.
  useEffect(() => { onValidityRef.current?.(firstError); }, [firstError]);
  useEffect(() => () => onValidityRef.current?.(null), []);
  const setFieldValidity = (name: string, error: string | null) => setFieldErrors((current) => {
    if (error === null) {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    }
    return current[name] === error ? current : { ...current, [name]: error };
  });
  const definition = catalog?.node_types.find((candidate) => candidate.type === node?.type);
  const targets = useMemo(
    () => (node ? validTargets(workflow.nodes, workflow.edges ?? [], node.id) : []),
    [node, workflow.nodes, workflow.edges],
  );
  const variables = useMemo(() => readableVariables(workflow, catalog, nodeId), [workflow, catalog, nodeId]);

  if (!node) return <p className="p-4 text-sm text-muted-foreground">Chọn một node để chỉnh sửa.</p>;

  const properties = schemaProperties(definition?.config_schema);
  const required = Array.isArray(definition?.config_schema?.required) ? (definition.config_schema.required as string[]) : [];
  const handles = nodeHandles(node, definition?.handles);
  const handleIds = handles.map((handle) => handle.id);
  const edges = workflow.edges ?? [];
  // Edges on a branch that was renamed or removed in config: the canvas cannot draw them, so list them here.
  const orphanEdges = definition
    ? edges.filter((edge) => edge.source === node.id && !handleIds.includes(edge.source_handle))
    : [];
  const { swatch } = nodeVisual(node.type);

  const changeConfig = (name: string, value: unknown) => {
    const nextConfig = { ...(node.config ?? {}) };
    if (value === undefined) {
      delete nextConfig[name];
    } else {
      nextConfig[name] = value;
    }
    onChange?.(updateNode(workflow, node.id, { config: nextConfig }));
  };

  const typeTitle = definition?.title ?? node.type;
  const displayName = node.title?.trim() || typeTitle;

  return (
    <section aria-label={`Biểu mẫu node ${displayName}`} className="flex max-h-full flex-col">
      <header className="space-y-2 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <NodeIcon type={node.type} />
          <input
            aria-label="Tiêu đề"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold hover:border-input focus:border-input focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:hover:border-transparent"
            value={node.title ?? ''}
            placeholder={typeTitle}
            disabled={readOnly}
            onChange={(event) => {
              const nextTitle = event.target.value;
              onChange?.(updateNode(workflow, node.id, { title: nextTitle.trim() ? nextTitle : undefined }));
            }}
          />
          {onClose ? (
            <button
              type="button"
              aria-label="Đóng bảng node"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{typeTitle}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">ID: {node.id}</span>
        </p>
        {definition?.description ? <p className="text-13 text-muted-foreground">{definition.description}</p> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Cấu hình">
          {!definition ? (
            <p className="text-sm text-muted-foreground">Chưa có catalog cho loại node này, chỉ sửa được ở tab JSON.</p>
          ) : properties.length ? (
            <div className="space-y-4">
              {properties.map(([name, property]) => (
                <NodeField
                  key={name}
                  name={name}
                  property={property}
                  value={node.config?.[name]}
                  required={required.includes(name)}
                  disabled={readOnly}
                  variables={variables}
                  onChange={(value) => changeConfig(name, value)}
                  onValidity={setFieldValidity}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Node này không có cấu hình.</p>
          )}
        </Section>

        {handles.length ? (
          <Section title="Bước tiếp theo">
            {routingError ? <p role="alert" className="text-xs text-destructive">{routingError}</p> : null}
            <div className="space-y-2">
              {handles.map((handle) => {
                const edge = edges.find((candidate) => candidate.source === node.id && candidate.source_handle === handle.id);
                const label = handleLabel(handle);
                return (
                  <div key={handle.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2">
                    <label htmlFor={`node-handle-${handle.id}`} className="flex min-w-0 items-center gap-2 text-13">
                      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', isErrorHandle(handle) ? 'bg-destructive/70' : swatch)} />
                      <span className="truncate">{label}</span>
                      {label !== handle.id ? <code className="truncate text-[11px] text-muted-foreground">{handle.id}</code> : null}
                    </label>
                    <select
                      id={`node-handle-${handle.id}`}
                      aria-label={`Khi ${handle.id}`}
                      className={cn('h-8 w-full rounded-md border border-input bg-background px-2 text-13', !edge && 'text-muted-foreground')}
                      value={edge?.target ?? ''}
                      disabled={readOnly}
                      onChange={(event) => {
                        try {
                          onChange?.(setHandleEdge(workflow, node.id, handle.id, event.target.value || null));
                          setRoutingError(null);
                        } catch (error) {
                          // The select snaps back to the stored target; say why instead of failing silently.
                          if (!(error instanceof WorkflowEditError)) throw error;
                          setRoutingError(`Không nối được nhánh "${handle.id}": ${error.message}`);
                        }
                      }}
                    >
                      <option value="">Chưa nối</option>
                      {targets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.title?.trim() || target.id}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        {orphanEdges.length ? (
          <div role="group" aria-label="Cạnh trên nhánh không còn tồn tại">
            <Section title="Cạnh trên nhánh không còn tồn tại" tone="danger">
              {orphanEdges.map((edge) => (
                <div key={edge.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    <code>{edge.source_handle}</code> → {edge.target}
                  </span>
                  <button
                    type="button"
                    className="text-xs underline disabled:opacity-50"
                    disabled={readOnly}
                    onClick={() => onChange?.(removeEdge(workflow, edge.id))}
                  >
                    Gỡ cạnh {edge.id}
                  </button>
                </div>
              ))}
            </Section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
