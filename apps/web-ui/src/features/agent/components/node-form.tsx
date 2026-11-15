'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { canonical } from '../model/config';
import { setHandleEdge, updateNode, WorkflowEditError } from '../model/workflow/edit';
import { validTargets } from '../model/workflow/graph';
import type { ChatflowNode, ChatflowWorkflow, NodeTypeCatalog, WorkflowHandleSpec } from '../types';

export interface NodeFormProps {
  workflow: ChatflowWorkflow;
  nodeId: string;
  catalog?: NodeTypeCatalog;
  readOnly?: boolean;
  onChange?: (next: ChatflowWorkflow) => void;
  /** Reports a field holding invalid JSON (or null), so the caller can block saving and leaving. */
  onValidity?: (error: string | null) => void;
}

type SchemaProperty = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function schemaProperties(schema: Record<string, unknown> | undefined): Array<[string, SchemaProperty]> {
  const properties = asObject(schema?.properties);
  if (!properties) return [];
  return Object.entries(properties).flatMap(([key, value]) => {
    const property = asObject(value);
    return property ? ([[key, property]] as Array<[string, SchemaProperty]>) : [];
  });
}

function jsonValue(value: unknown, defaultValue?: unknown): string {
  const effective = value !== undefined ? value : defaultValue;
  return JSON.stringify(effective ?? null, null, 2);
}

function displayValue(value: unknown, property: SchemaProperty): string {
  if (value === undefined && property.default !== undefined) value = property.default;
  if (value === undefined || value === null) return '';
  return String(value);
}

function handleNames(node: ChatflowNode, spec: WorkflowHandleSpec | undefined): string[] {
  if (!spec) return [];
  const names = [...spec.static];
  if (spec.from_config) {
    const values = node.config?.[spec.from_config.array];
    if (Array.isArray(values)) {
      for (const value of values) {
        const item = asObject(value);
        const handle = item?.[spec.from_config.id_field];
        if (typeof handle === 'string') names.push(handle);
      }
    }
  }
  return [...new Set(names)];
}

function fieldType(property: SchemaProperty): string {
  if (Array.isArray(property.enum)) return 'enum';
  if (typeof property.type === 'string') return property.type;
  if (Array.isArray(property.anyOf)) return 'json';
  return 'json';
}

function parseInput(value: string, type: string): unknown {
  if (type === 'number' || type === 'integer') return value === '' ? undefined : Number(value);
  if (type === 'boolean') return value === 'true';
  return value;
}

function JsonTextareaField({
  name,
  label,
  value,
  defaultValue,
  disabled,
  widget,
  onChange,
  onValidity,
}: {
  name: string;
  label: string;
  value: unknown;
  defaultValue?: unknown;
  disabled: boolean;
  widget?: string;
  onChange: (value: unknown) => void;
  onValidity: (error: string | null) => void;
}) {
  const [text, setText] = useState(() => jsonValue(value, defaultValue));
  const [error, setError] = useState<string | null>(null);
  const lastCanonical = useRef(canonical(value));

  // Resync only on outside edits (canvas, JSON tab): echoing our own edit back would reformat the text and move the caret.
  useEffect(() => {
    const nextCanonical = canonical(value);
    if (!error && nextCanonical !== lastCanonical.current) {
      lastCanonical.current = nextCanonical;
      setText(jsonValue(value, defaultValue));
    }
  }, [value, defaultValue, error]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`node-config-${name}`}>{label}</Label>
      <Textarea
        id={`node-config-${name}`}
        aria-label={label}
        rows={widget ? 4 : 3}
        className="font-mono text-xs"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          try {
            // An emptied field unsets the key instead of being a syntax error.
            const parsed = nextText.trim() === '' ? undefined : JSON.parse(nextText);
            lastCanonical.current = canonical(parsed);
            setError(null);
            onValidity(null);
            onChange(parsed);
          } catch (err) {
            setError((err as Error).message);
            onValidity(`${label}: JSON chưa hợp lệ`);
          }
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          JSON chưa hợp lệ: {error}
        </p>
      ) : widget ? (
        <p className="text-xs text-muted-foreground">Trình chỉnh sửa JSON cho widget runtime: {widget}</p>
      ) : null}
    </div>
  );
}

function NodeField({
  name,
  property,
  value,
  disabled,
  onChange,
  onValidity,
}: {
  name: string;
  property: SchemaProperty;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
  onValidity: (error: string | null) => void;
}) {
  const label = typeof property.title === 'string' ? property.title : name;
  const widget = typeof property['x-widget'] === 'string' ? property['x-widget'] : undefined;
  const type = fieldType(property);

  if (widget || type === 'json' || type === 'object' || type === 'array') {
    return (
      <JsonTextareaField
        name={name}
        label={label}
        value={value}
        defaultValue={property.default}
        disabled={disabled}
        widget={widget}
        onChange={onChange}
        onValidity={onValidity}
      />
    );
  }

  if (type === 'enum') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`node-config-${name}`}>{label}</Label>
        <select
          id={`node-config-${name}`}
          aria-label={label}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={displayValue(value, property)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Chọn…</option>
          {(property.enum as unknown[]).map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (type === 'boolean') {
    const isChecked = value !== undefined ? value === true : property.default === true;
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label={label}
          checked={isChecked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`node-config-${name}`}>{label}</Label>
      <Input
        id={`node-config-${name}`}
        aria-label={label}
        type={type === 'number' || type === 'integer' ? 'number' : 'text'}
        value={displayValue(value, property)}
        disabled={disabled}
        onChange={(event) => onChange(parseInput(event.target.value, type))}
      />
    </div>
  );
}

export function NodeForm({ workflow, nodeId, catalog, readOnly = false, onChange, onValidity }: NodeFormProps) {
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

  if (!node) return <p className="text-sm text-muted-foreground">Chọn một node để chỉnh sửa.</p>;

  const properties = schemaProperties(definition?.config_schema);
  const handles = handleNames(node, definition?.handles);
  const edges = workflow.edges ?? [];

  const changeConfig = (name: string, value: unknown) => {
    const nextConfig = { ...(node.config ?? {}) };
    if (value === undefined) {
      delete nextConfig[name];
    } else {
      nextConfig[name] = value;
    }
    onChange?.(updateNode(workflow, node.id, { config: nextConfig }));
  };

  const displayName = node.title?.trim() || definition?.title || node.type;

  return (
    <section aria-label={`Biểu mẫu node ${displayName}`} className="space-y-4 rounded-md border bg-card p-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{displayName}</h3>
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{node.type}</span>
        </div>
        <p className="font-mono text-xs text-muted-foreground">ID: {node.id}</p>
        {definition?.description ? <p className="text-sm text-muted-foreground">{definition.description}</p> : null}
      </div>

      <div className="space-y-1.5 border-t pt-3">
        <Label htmlFor="node-title">Tiêu đề</Label>
        <Input
          id="node-title"
          aria-label="Tiêu đề"
          value={node.title ?? ''}
          placeholder={definition?.title ?? node.type}
          disabled={readOnly}
          onChange={(event) => {
            const nextTitle = event.target.value;
            onChange?.(updateNode(workflow, node.id, { title: nextTitle.trim() ? nextTitle : undefined }));
          }}
        />
      </div>

      {properties.length ? (
        <div className="space-y-3 border-t pt-3">
          <h4 className="text-sm font-medium">Cấu hình</h4>
          {properties.map(([name, property]) => (
            <NodeField
              key={name}
              name={name}
              property={property}
              value={node.config?.[name]}
              disabled={readOnly}
              onChange={(value) => changeConfig(name, value)}
              onValidity={(error) => setFieldValidity(name, error)}
            />
          ))}
        </div>
      ) : (
        <p className="border-t pt-3 text-sm text-muted-foreground">Node này không có cấu hình.</p>
      )}

      {handles.length ? (
        <div className="space-y-3 border-t pt-3">
          <h4 className="text-sm font-medium">Điều hướng</h4>
          {routingError ? <p role="alert" className="text-xs text-destructive">{routingError}</p> : null}
          {handles.map((handle) => {
            const edge = edges.find((candidate) => candidate.source === node.id && candidate.source_handle === handle);
            return (
              <div key={handle} className="space-y-1.5">
                <Label htmlFor={`node-handle-${handle}`}>
                  Khi <code>{handle}</code> →
                </Label>
                <select
                  id={`node-handle-${handle}`}
                  aria-label={`Khi ${handle}`}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={edge?.target ?? ''}
                  disabled={readOnly}
                  onChange={(event) => {
                    try {
                      onChange?.(setHandleEdge(workflow, node.id, handle, event.target.value || null));
                      setRoutingError(null);
                    } catch (error) {
                      // The select snaps back to the stored target; say why instead of failing silently.
                      if (!(error instanceof WorkflowEditError)) throw error;
                      setRoutingError(`Không nối được nhánh "${handle}": ${error.message}`);
                    }
                  }}
                >
                  <option value="">Không nối</option>
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
      ) : null}
    </section>
  );
}
