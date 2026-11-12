'use client';

import type { ChatflowWorkflow } from '../types';
import { JsonObjectEditor } from './json-section';

/** Workflow-scoped JSON editor sharing draft state; invalid JSON reports an error so navigation and saves stay blocked. */
export function WorkflowJsonTab({
  workflow, onReplace, onValidity, readOnly = false,
}: {
  workflow: ChatflowWorkflow | Record<string, unknown> | undefined;
  onReplace: (next: Record<string, unknown>) => void;
  onValidity: (error: string | null) => void;
  readOnly?: boolean;
}) {
  return (
    <JsonObjectEditor
      value={(workflow ?? {}) as Record<string, unknown>}
      onReplace={onReplace}
      onValidity={onValidity}
      id="field-workflow"
      ariaLabel="Workflow JSON"
      notObjectMessage="Workflow phải là một JSON object"
      readOnly={readOnly}
    />
  );
}
