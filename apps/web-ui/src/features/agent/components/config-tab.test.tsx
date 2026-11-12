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

function Harness({
  validation = null, onConfig = () => {}, initial = SEED, initialSection = 'persona' as SectionId, mode = 'agent' as 'agent' | 'chatflow',
}: {
  validation?: ValidationState | null; onConfig?: (c: AgentConfig) => void; initial?: AgentConfig; initialSection?: SectionId; mode?: 'agent' | 'chatflow';
}) {
  const [config, setConfig] = useState(initial);
  const [section, setSection] = useState<SectionId>(initialSection);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const update = (next: AgentConfig) => { setConfig(next); onConfig(next); };
  return (
    <ConfigTab config={config} onChange={(path: Path, value) => update(setIn(config, path, value))} onReplace={update}
      section={section} onSection={id => { if (!jsonError) setSection(id); }} onJsonValidity={setJsonError}
      validation={validation} onBindKb={() => {}} mode={mode} />
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

  it('shares workflow state in the Chatflow JSON tab and blocks leaving while JSON is broken', () => {
    const onConfig = vi.fn();
    const chatflowSeed: AgentConfig = {
      ...SEED,
      mode: 'chatflow',
      workflow: { entry: 'start', nodes: [{ id: 'start', type: 'start', title: 'Bắt đầu' }], edges: [] },
    };
    render(<Harness initial={chatflowSeed} initialSection="chatflow" mode="chatflow" onConfig={onConfig} />);

    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    const editor = screen.getByLabelText('Workflow JSON') as HTMLTextAreaElement;
    expect(editor.value).toContain('"entry": "start"');

    const edited = { entry: 'start', nodes: [{ id: 'start', type: 'start', title: 'Khởi đầu mới' }], edges: [] };
    fireEvent.change(editor, { target: { value: JSON.stringify(edited, null, 2) } });
    expect(onConfig).toHaveBeenLastCalledWith(expect.objectContaining({ workflow: edited, extra_field: { keep: true } }));

    fireEvent.change(editor, { target: { value: '{ "entry": ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('JSON chưa hợp lệ');

    fireEvent.click(screen.getByRole('tab', { name: 'Sơ đồ' }));
    expect(screen.getByLabelText('Workflow JSON')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    expect(screen.getByLabelText('Workflow JSON')).toBeInTheDocument();
  });

  it('opens the Chatflow JSON tab and highlights the target node when a workflow issue is clicked', async () => {
    const chatflowSeed: AgentConfig = {
      ...SEED,
      mode: 'chatflow',
      workflow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'start', title: 'Bắt đầu' },
          { id: 'classify', type: 'if_else', config: { labels: ['hoc_phi'] } },
        ],
        edges: [],
      },
    };
    const validation: ValidationState = {
      valid: false,
      stale: false,
      checkedAt: new Date().toISOString(),
      issues: [{ path: 'workflow.nodes[1].config.labels[0]', code: 'workflow_unwired_label', message: 'Nhãn chưa nối' }],
    };
    render(<Harness initial={chatflowSeed} initialSection="model" mode="chatflow" validation={validation} />);

    expect(screen.queryByLabelText('Workflow JSON')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Nhãn chưa nối/ }));

    const editor = await screen.findByLabelText('Workflow JSON') as HTMLTextAreaElement;
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(editor);
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toContain('"labels"');
  });
});
