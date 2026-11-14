import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatflowWorkflow, NodeTypeCatalog } from '../types';
import { NodeForm } from './node-form';

const catalog: NodeTypeCatalog = {
  catalog_version: 'test',
  namespaces: [],
  node_types: [
    {
      type: 'if_else',
      title: 'Rẽ nhánh',
      description: 'Phân nhánh điều kiện logic',
      config_schema: {
        type: 'object',
        properties: {
          condition: { type: 'object', 'x-widget': 'condition_builder' },
          retries: { type: 'integer', default: 2 },
          tone: { type: 'string', enum: ['friendly', 'formal'] },
          is_active: { type: 'boolean', default: true },
        },
      },
      handles: { static: ['true', 'false'] },
      output_schema: { type: 'object' },
    },
    {
      type: 'answer',
      title: 'Trả lời',
      description: 'Phản hồi tin nhắn',
      config_schema: {
        type: 'object',
        properties: {
          template: { type: 'string', title: 'Mẫu câu trả lời' },
        },
      },
      handles: { static: [] },
      output_schema: { type: 'object' },
    },
    {
      type: 'start',
      title: 'Bắt đầu',
      description: 'Điểm bắt đầu luồng',
      config_schema: { type: 'object', properties: {} },
      handles: { static: ['next'] },
      output_schema: { type: 'object' },
    },
  ],
};

const workflow: ChatflowWorkflow = {
  entry: 'start_node',
  nodes: [
    { id: 'start_node', type: 'start' },
    { id: 'branch', type: 'if_else', title: 'Kiểm tra', config: { condition: { '==': [1, 1] } } },
    { id: 'answer_a', type: 'answer', title: 'Có' },
    { id: 'answer_b', type: 'answer', title: 'Không' },
  ],
  edges: [
    { id: 'e_start_next', source: 'start_node', source_handle: 'next', target: 'branch' },
  ],
};

describe('NodeForm', () => {
  it('renders catalog fields and falls back to JSON for x-widget properties', () => {
    render(<NodeForm workflow={workflow} nodeId="branch" catalog={catalog} />);
    expect(screen.getByLabelText('condition')).toHaveValue(JSON.stringify({ '==': [1, 1] }, null, 2));
    expect(screen.getByLabelText('retries')).toHaveValue(2);
    expect(screen.getByRole('combobox', { name: 'tone' })).toBeInTheDocument();
    expect(screen.getByText(/condition_builder/)).toBeInTheDocument();
  });

  it('allows editing JSON in x-widget textarea and displays an error alert on invalid JSON without losing typed input', () => {
    const onChange = vi.fn();
    render(<NodeForm workflow={workflow} nodeId="branch" catalog={catalog} onChange={onChange} />);
    const condition = screen.getByLabelText('condition');

    // Type invalid JSON
    fireEvent.change(condition, { target: { value: '{ "incomplete": ' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/JSON chưa hợp lệ/);
    expect(condition).toHaveValue('{ "incomplete": ');
    expect(onChange).not.toHaveBeenCalled();

    // Correct to valid JSON
    fireEvent.change(condition, { target: { value: '{"valid": true}' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: 'branch',
            config: expect.objectContaining({ condition: { valid: true } }),
          }),
        ]),
      }),
    );
  });

  it('offers only valid graph targets for every handle and prevents cycle targets (AT #2)', () => {
    const onChange = vi.fn();
    render(<NodeForm workflow={workflow} nodeId="branch" catalog={catalog} onChange={onChange} />);

    const trueSelect = screen.getByRole('combobox', { name: 'Khi true' });
    // Ancestor 'start_node' and self 'branch' must be excluded from valid targets
    expect(trueSelect).toHaveTextContent('Có');
    expect(trueSelect).toHaveTextContent('Không');
    expect(trueSelect).not.toHaveTextContent('start_node');
    expect(trueSelect).not.toHaveTextContent('Kiểm tra');

    fireEvent.change(trueSelect, { target: { value: 'answer_a' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        edges: expect.arrayContaining([
          expect.objectContaining({ source: 'branch', source_handle: 'true', target: 'answer_a' }),
        ]),
      }),
    );
  });

  it('wires multiple handles via dropdowns and supports disconnecting an edge (AT #1)', () => {
    const onChange = vi.fn();
    // Start with 'true' handle already connected to answer_a
    const workflowWithEdge: ChatflowWorkflow = {
      ...workflow,
      edges: [
        ...(workflow.edges ?? []),
        { id: 'e_branch_true', source: 'branch', source_handle: 'true', target: 'answer_a' },
      ],
    };

    render(
      <NodeForm workflow={workflowWithEdge} nodeId="branch" catalog={catalog} onChange={onChange} />,
    );

    // Wire 'false' handle to answer_b
    const falseSelect = screen.getByRole('combobox', { name: 'Khi false' });
    fireEvent.change(falseSelect, { target: { value: 'answer_b' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        edges: expect.arrayContaining([
          expect.objectContaining({ source: 'branch', source_handle: 'true', target: 'answer_a' }),
          expect.objectContaining({ source: 'branch', source_handle: 'false', target: 'answer_b' }),
        ]),
      }),
    );

    // Disconnect 'true' handle by choosing 'Không nối'
    const trueSelect = screen.getByRole('combobox', { name: 'Khi true' });
    fireEvent.change(trueSelect, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        edges: expect.not.arrayContaining([
          expect.objectContaining({ source: 'branch', source_handle: 'true' }),
        ]),
      }),
    );
  });

  it('dynamically displays an optional field added to the catalog schema without web-ui code changes (AT #7)', () => {
    const dynamicCatalog: NodeTypeCatalog = {
      ...catalog,
      node_types: [
        ...catalog.node_types.filter((item) => item.type !== 'answer'),
        {
          type: 'answer',
          title: 'Trả lời',
          description: 'Phản hồi tin nhắn',
          config_schema: {
            type: 'object',
            properties: {
              template: { type: 'string', title: 'Mẫu câu trả lời' },
              quick_replies: { type: 'array', title: 'Gợi ý nhanh' },
            },
          },
          handles: { static: [] },
          output_schema: { type: 'object' },
        },
      ],
    };

    const { rerender } = render(<NodeForm workflow={workflow} nodeId="answer_a" catalog={catalog} />);
    expect(screen.queryByLabelText('Gợi ý nhanh')).not.toBeInTheDocument();

    rerender(<NodeForm workflow={workflow} nodeId="answer_a" catalog={dynamicCatalog} />);
    expect(screen.getByLabelText('Gợi ý nhanh')).toBeInTheDocument();
  });

  it('updates node title and primitive config values', () => {
    const onChange = vi.fn();
    render(<NodeForm workflow={workflow} nodeId="branch" catalog={catalog} onChange={onChange} />);

    // Edit title
    const titleInput = screen.getByLabelText('Tiêu đề');
    fireEvent.change(titleInput, { target: { value: 'Rẽ nhánh theo điểm số' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'branch', title: 'Rẽ nhánh theo điểm số' }),
        ]),
      }),
    );

    // Edit number input
    const retriesInput = screen.getByLabelText('retries');
    fireEvent.change(retriesInput, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: 'branch',
            config: expect.objectContaining({ retries: 5 }),
          }),
        ]),
      }),
    );

    // Edit enum combobox
    const toneSelect = screen.getByRole('combobox', { name: 'tone' });
    fireEvent.change(toneSelect, { target: { value: 'friendly' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: 'branch',
            config: expect.objectContaining({ tone: 'friendly' }),
          }),
        ]),
      }),
    );

    // Edit boolean checkbox
    const checkbox = screen.getByLabelText('is_active');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: 'branch',
            config: expect.objectContaining({ is_active: false }),
          }),
        ]),
      }),
    );
  });

  it('respects read-only mode for title, config fields and handles', () => {
    const onChange = vi.fn();
    render(<NodeForm workflow={workflow} nodeId="branch" catalog={catalog} readOnly onChange={onChange} />);

    expect(screen.getByLabelText('Tiêu đề')).toBeDisabled();
    expect(screen.getByLabelText('retries')).toBeDisabled();
    expect(screen.getByLabelText('condition')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'tone' })).toBeDisabled();
    expect(screen.getByLabelText('is_active')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Khi true' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Khi false' })).toBeDisabled();
  });
});
