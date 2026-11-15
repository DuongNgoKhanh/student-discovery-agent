'use client';

import type { DragEvent } from 'react';
import { MAX_WORKFLOW_NODES } from '../model/workflow/edit';
import type { ChatflowNodeType, NodeTypeCatalog } from '../types';

export const WORKFLOW_PALETTE_MIME = 'application/x-chatflow-node-type';

export interface NodePaletteProps {
  catalog?: NodeTypeCatalog;
  onAddNode: (type: ChatflowNodeType, position?: { x: number; y: number }) => void;
  disabled?: boolean;
  nodeCount?: number;
}

/** Palette of runtime-published node types (excluding `start`) that can be clicked or dragged onto the canvas. */
export function NodePalette({ catalog, onAddNode, disabled, nodeCount = 0 }: NodePaletteProps) {
  const addableTypes = (catalog?.node_types ?? []).filter((item) => item.type !== 'start');
  const limitReached = nodeCount >= MAX_WORKFLOW_NODES;
  const isButtonDisabled = Boolean(disabled) || limitReached;

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, type: ChatflowNodeType) => {
    if (isButtonDisabled || !event.dataTransfer) return;
    event.dataTransfer.setData(WORKFLOW_PALETTE_MIME, type);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      role="toolbar"
      aria-label="Thêm node"
      data-testid="workflow-node-palette"
      className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2"
    >
      {addableTypes.map((item) => {
        const label = item.title || item.type;
        return (
          <button
            key={item.type}
            type="button"
            aria-label={`Thêm node ${label}`}
            data-node-type={item.type}
            title={item.description || undefined}
            disabled={isButtonDisabled}
            draggable={!isButtonDisabled}
            onClick={() => onAddNode(item.type)}
            onDragStart={(event) => handleDragStart(event, item.type)}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-primary-subtle hover:text-primary disabled:pointer-events-none disabled:opacity-50"
          >
            + {label}
          </button>
        );
      })}
      {limitReached ? (
        <span className="text-xs text-muted-foreground">Đã đạt giới hạn {MAX_WORKFLOW_NODES} node</span>
      ) : null}
    </div>
  );
}
