import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { setIn, type Path } from '../model/config';
import type { SectionId } from '../model/sections';
import type { AgentConfig } from '../types';
import { ConfigTab } from './config-tab';
import type { ValidationState } from './issues-panel';

vi.mock('@/features/knowledge', async original => ({
  ...(await original<typeof import('@/features/knowledge')>()),
  useKnowledgeBases: () => ({ data: [{ id: 'kb1', name: 'KB 1' }] }),
}));

const SEED: AgentConfig = { greeting_text: 'Chào', persona: { name: 'IHRD', system_prompt: 'x' }, model: { ref: 'gemini/x' }, extra_field: { keep: true } };

function Harness({ validation = null, onConfig = () => {} }: { validation?: ValidationState | null; onConfig?: (c: AgentConfig) => void }) {
  const [config, setConfig] = useState(SEED);
  const [section, setSection] = useState<SectionId>('persona');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const update = (next: AgentConfig) => { setConfig(next); onConfig(next); };
  return (
    <ConfigTab config={config} onChange={(path: Path, value) => update(setIn(config, path, value))} onReplace={update}
      section={section} onSection={id => { if (!jsonError) setSection(id); }} onJsonValidity={setJsonError}
      validation={validation} preselectKb={null} />
  );
}

describe('ConfigTab', () => {
  it('edits a form field and keeps fields the form does not show', () => {
    const onConfig = vi.fn();
    render(<Harness onConfig={onConfig} />);
    fireEvent.change(screen.getByLabelText('Tên agent'), { target: { value: 'Mentor' } });
    expect(onConfig).toHaveBeenLastCalledWith(expect.objectContaining({ persona: expect.objectContaining({ name: 'Mentor' }), extra_field: { keep: true } }));
  });

  it('shares state with the JSON tab and blocks leaving it while JSON is broken', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const editor = screen.getByLabelText('Cấu hình JSON');
    expect((editor as HTMLTextAreaElement).value).toContain('"extra_field"');
    fireEvent.change(editor, { target: { value: '{ "greeting_text": ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('JSON chưa hợp lệ');
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    expect(screen.getByLabelText('Cấu hình JSON')).toBeInTheDocument();
  });

  it('jumps to the field of a clicked issue', async () => {
    const validation = { issues: [{ path: 'model.ref', code: 'value_error', message: 'Provider không hỗ trợ' }], valid: false, checkedAt: new Date().toISOString(), stale: false };
    render(<Harness validation={validation} />);
    fireEvent.click(screen.getByRole('button', { name: /Provider không hỗ trợ/ }));
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement?.id).toBe('field-model.ref');
    expect(screen.getAllByText('Provider không hỗ trợ').length).toBeGreaterThan(1);
  });
});
