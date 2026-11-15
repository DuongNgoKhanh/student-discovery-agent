'use client';

import type { DragEvent } from 'react';
import { MAX_WORKFLOW_NODES } from '../model/workflow/edit';
import type { ChatflowNodeType, NodeTypeCatalog } from '../types';
import { NodeIcon } from './node-visuals';

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
      aria-orientation="vertical"
      data-testid="workflow-node-palette"
      className="flex w-48 flex-col gap-0.5 rounded-xl border bg-card/95 p-1.5 shadow-md backdrop-blur"
    >
      <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">Bấm hoặc kéo vào sơ đồ</p>
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
            className="flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left text-13 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
          >
            <NodeIcon type={item.type} size="sm" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
      {limitReached ? (
        <span className="px-2 pt-1 text-xs text-muted-foreground">Đã đạt giới hạn {MAX_WORKFLOW_NODES} node</span>
      ) : null}
    </div>
  );
}
