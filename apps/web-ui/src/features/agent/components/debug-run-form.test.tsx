import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDebugRunRequest } from '../types';
import { DebugRunForm } from './debug-run-form';

describe('DebugRunForm', () => {
  it('submits a message with parsed simulated state and LLM stubs', () => {
    const onSubmit = vi.fn();
    render(<DebugRunForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('State giả lập'), { target: { value: '{"conv":{"stage":"start"}}' } });
    fireEvent.change(screen.getByLabelText('LLM stubs (tuỳ chọn)'), { target: { value: '{"answer":{"text":"ok"}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'học phí MTU',
      state: { conv: { stage: 'start' } },
      llm_stubs: { answer: { text: 'ok' } },
    } satisfies WorkflowDebugRunRequest);
  });

  it('submits exactly one interaction input instead of a message', () => {
    const onSubmit = vi.fn();
    render(<DebugRunForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Loại input'), { target: { value: 'interaction' } });
    fireEvent.change(screen.getByLabelText('Nội dung input'), { target: { value: 'confirm_answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    // Studio's strict schema takes {action, outcome?, option_id?}; any other key is a 422.
    expect(onSubmit).toHaveBeenCalledWith({
      interaction: { action: 'confirm_answer' },
      state: {},
      llm_stubs: {},
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('message');
  });

  it('adds option_id to the interaction only when one is given', () => {
    const onSubmit = vi.fn();
    render(<DebugRunForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Loại input'), { target: { value: 'interaction' } });
    fireEvent.change(screen.getByLabelText('Nội dung input'), { target: { value: 'submit_answer' } });
    fireEvent.change(screen.getByLabelText('option_id (tuỳ chọn)'), { target: { value: ' opt_2 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    expect(onSubmit).toHaveBeenCalledWith({
      interaction: { action: 'submit_answer', option_id: 'opt_2' },
      state: {},
      llm_stubs: {},
    } satisfies WorkflowDebugRunRequest);
  });

  it('rejects blank input and non-object JSON without submitting', () => {
    const onSubmit = vi.fn();
    render(<DebugRunForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Nội dung input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập message trước khi chạy');

    fireEvent.change(screen.getByLabelText('Nội dung input'), { target: { value: 'hello' } });
    fireEvent.change(screen.getByLabelText('State giả lập'), { target: { value: '[]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('State và LLM stubs phải là JSON object');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
