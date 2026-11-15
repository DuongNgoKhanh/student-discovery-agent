import type { ChatflowNode, WorkflowHandleSpec } from '../../types';

/** An outgoing branch of a node: static from the catalog, or generated from a config array (intent labels). */
export interface NodeHandle {
  id: string;
  fromConfig: boolean;
}

const STATIC_LABELS: Record<string, string> = {
  next: 'Tiếp theo',
  true: 'Đúng',
  false: 'Sai',
  success: 'Thành công',
  error: 'Lỗi',
  handoff: 'Chuyển giao',
  other: 'Khác',
  found: 'Có kết quả',
  empty: 'Không có kết quả',
  proposed: 'Đã đề xuất',
  none: 'Không đề xuất',
};

/** Ordered handles of a node: the catalog's static ones, then one per config item (deduplicated). */
export function nodeHandles(node: ChatflowNode, spec: WorkflowHandleSpec | undefined): NodeHandle[] {
  if (!spec) return [];
  const handles: NodeHandle[] = spec.static.map((id) => ({ id, fromConfig: false }));
  const generated = spec.from_config;
  const values = generated ? node.config?.[generated.array] : undefined;
  if (generated && Array.isArray(values)) {
    for (const value of values) {
      const id = value && typeof value === 'object' ? (value as Record<string, unknown>)[generated.id_field] : undefined;
      if (typeof id === 'string') handles.push({ id, fromConfig: true });
    }
  }
  const seen = new Set<string>();
  return handles.filter((handle) => !seen.has(handle.id) && seen.add(handle.id));
}

/** Readable name of a handle: static handles are translated, generated ones are the id the admin typed. */
export function handleLabel(handle: NodeHandle): string {
  return handle.fromConfig ? handle.id : STATIC_LABELS[handle.id] ?? handle.id;
}

/** Static handles a run takes when something fails: drawn muted so the happy path stands out. */
export function isErrorHandle(handle: NodeHandle): boolean {
  return !handle.fromConfig && handle.id === 'error';
}
