'use client';

import { Plus } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

/** "Thêm node" button opening the runtime-published node types (excluding `start`), to click or drag onto the canvas. */
export function NodePalette({ catalog, onAddNode, disabled, nodeCount = 0 }: NodePaletteProps) {
  const [open, setOpen] = useState(false);
  const addableTypes = (catalog?.node_types ?? []).filter((item) => item.type !== 'start');
  const limitReached = nodeCount >= MAX_WORKFLOW_NODES;
  const isButtonDisabled = Boolean(disabled) || limitReached;

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, type: ChatflowNodeType) => {
    if (isButtonDisabled || !event.dataTransfer) return;
    event.dataTransfer.setData(WORKFLOW_PALETTE_MIME, type);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="workflow-node-palette"
          className="flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-13 font-medium shadow-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <Plus className="size-4" /> Thêm node
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-1.5">
        <div role="toolbar" aria-label="Thêm node" aria-orientation="vertical" className="flex max-h-[min(28rem,60vh)] flex-col gap-0.5 overflow-y-auto">
          <p className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">Bấm để thêm, hoặc kéo vào vị trí trên sơ đồ.</p>
          {addableTypes.map((item) => {
            const label = item.title || item.type;
            return (
              <button
                key={item.type}
                type="button"
                aria-label={`Thêm node ${label}`}
                data-node-type={item.type}
                disabled={isButtonDisabled}
                draggable={!isButtonDisabled}
                onClick={() => {
                  onAddNode(item.type);
                  setOpen(false);
                }}
                onDragStart={(event) => handleDragStart(event, item.type)}
                // Closing on drag start would unmount the drag source mid-drag.
                onDragEnd={() => setOpen(false)}
                className="flex cursor-grab items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
              >
                <NodeIcon type={item.type} size="sm" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-13 font-medium">{label}</span>
                  {item.description ? <span className="block text-xs text-muted-foreground">{item.description}</span> : null}
                </span>
              </button>
            );
          })}
          {limitReached ? (
            <span className="px-2 pt-1 text-xs text-muted-foreground">Đã đạt giới hạn {MAX_WORKFLOW_NODES} node</span>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
