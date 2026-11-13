'use client';

import type { AgentMode } from '../model/sections';

export function ModeSwitch({ mode, onChange, disabled }: { mode: AgentMode; onChange: (mode: AgentMode) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Chế độ tác giả" className="flex items-center gap-1 rounded-lg border p-1">
      {(['agent', 'chatflow'] as const).map(option => (
        <button key={option} type="button" role="radio" aria-checked={mode === option} disabled={disabled} onClick={() => onChange(option)}
          className={mode === option ? 'rounded-md bg-primary px-3 py-1.5 text-13 font-medium text-primary-foreground disabled:opacity-50' : 'rounded-md px-3 py-1.5 text-13 text-muted-foreground hover:bg-primary-subtle disabled:opacity-50'}>
          {option === 'agent' ? 'Agent' : 'Chatflow'}
        </button>
      ))}
    </div>
  );
}
