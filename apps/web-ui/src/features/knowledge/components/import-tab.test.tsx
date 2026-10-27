import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeApi } from '../api/knowledge';
import { ImportTab } from './import-tab';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { listFields: vi.fn(), previewImport: vi.fn(), commitImport: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);
const payload = { title: 'HUTECH', body: '# HUTECH', source_url: null, metadata: {} };

describe('ImportTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.listFields.mockResolvedValue([]);
  });

  it('previews uploaded Markdown files and commits only rows that write', async () => {
    mocked.previewImport.mockResolvedValue({ rows: [
      { row: 1, source: 'tuyen-sinh-hutech.md', document_id: 'tuyen-sinh-hutech', action: 'create', expected_revision: 0, errors: [], payload },
      { row: 2, source: 'tuyen-sinh-ptit.md', document_id: 'tuyen-sinh-ptit', action: 'unchanged', expected_revision: 1, errors: [], payload },
      { row: 3, source: 'scan.pdf', document_id: null, action: 'invalid', expected_revision: null, errors: ['Chỉ nhận file .md'], payload: null },
    ] });
    mocked.commitImport.mockResolvedValue({ import_id: 'imp_1', created: 1, updated: 0, unchanged: 0, conflict: 0, failed: 0, rows: [
      { row: 1, document_id: 'tuyen-sinh-hutech', outcome: 'created', revision: 1, error: null },
    ] });
    render(<QueryClientProvider client={new QueryClient()}><ImportTab kb="kb1" /></QueryClientProvider>);

    const file = new File(['# HUTECH'], 'tuyen-sinh-hutech.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByLabelText('File Markdown/TXT'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước' }));
    await waitFor(() => expect(mocked.previewImport).toHaveBeenCalledWith({
      kb: 'kb1', body: { kind: 'files', files: [{ name: 'tuyen-sinh-hutech.md', content: '# HUTECH' }] },
    }));
    expect(await screen.findByText('Chỉ nhận file .md')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ghi 1 dòng' }));
    await waitFor(() => expect(mocked.commitImport).toHaveBeenCalledTimes(1));
    const body = mocked.commitImport.mock.calls[0]![0].body;
    expect(body.rows).toEqual([{ row: 1, document_id: 'tuyen-sinh-hutech', expected_revision: 0, payload }]);
    expect(body.idempotency_key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(await screen.findByText(/Tạo 1/)).toBeInTheDocument();
  });

  it('drops the old preview when the selected file changes', async () => {
    mocked.previewImport.mockResolvedValue({ rows: [
      { row: 1, source: 'a.md', document_id: 'a', action: 'create', expected_revision: 0, errors: [], payload },
    ] });
    render(<QueryClientProvider client={new QueryClient()}><ImportTab kb="kb1" /></QueryClientProvider>);

    const input = screen.getByLabelText('File Markdown/TXT');
    fireEvent.change(input, { target: { files: [new File(['# A'], 'a.md')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước' }));
    expect(await screen.findByRole('button', { name: 'Ghi 1 dòng' })).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(['# B'], 'b.md')] } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ghi 1 dòng' })).not.toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('forgets the column mapping when a different CSV is loaded', async () => {
    mocked.previewImport.mockResolvedValue({ rows: [] });
    render(<QueryClientProvider client={new QueryClient()}><ImportTab kb="kb1" /></QueryClientProvider>);
    fireEvent.click(screen.getByLabelText('CSV'));

    const first = 'id,title,body\n1,A,B';
    fireEvent.change(screen.getByLabelText('File CSV'), { target: { files: [new File([first], 'one.csv')] } });
    fireEvent.change(await screen.findByLabelText('document_id'), { target: { value: 'id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước' }));
    await waitFor(() => expect(mocked.previewImport).toHaveBeenCalledWith({
      kb: 'kb1', body: { kind: 'csv', content: first, mapping: { document_id: 'id', metadata: {} } },
    }));

    const second = 'ma,ten\n1,A';
    fireEvent.change(screen.getByLabelText('File CSV'), { target: { files: [new File([second], 'two.csv')] } });
    await waitFor(() => expect(screen.getByLabelText('document_id')).toHaveValue(''));
    expect(screen.getByLabelText('document_id')).toHaveDisplayValue('(không map)');
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'ten' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước' }));
    await waitFor(() => expect(mocked.previewImport).toHaveBeenCalledTimes(2));
    expect(mocked.previewImport.mock.calls[1]![0].body).toEqual({ kind: 'csv', content: second, mapping: { title: 'ten', metadata: {} } });
  });
});
