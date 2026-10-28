import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '@/test/render';
import { knowledgeApi } from '../api/knowledge';
import { ImportTab } from './import-tab';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { listFields: vi.fn(), previewImport: vi.fn(), commitImport: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);
const payload = { title: 'HUTECH', body: '# HUTECH', source_url: null, metadata: {} };
const createRow = (row: number, id: string) => ({ row, source: `${id}.md`, document_id: id, action: 'create' as const, expected_revision: 0, errors: [], payload });
const report = (created: number) => ({ import_id: 'imp', created, updated: 0, unchanged: 0, conflict: 0, failed: 0, rows: [] });

// Radix Select needs pointer-capture and scrolling APIs jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

const renderImport = () => render(<TestProviders client={new QueryClient()}><ImportTab kb="kb1" /></TestProviders>);
const addFiles = (...files: File[]) => fireEvent.change(screen.getByLabelText('File cần nhập'), { target: { files } });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
function pick(label: string, option: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('ImportTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.listFields.mockResolvedValue([]);
  });

  it('previews uploaded Markdown files and commits only rows that write', async () => {
    mocked.previewImport.mockResolvedValue({ rows: [
      createRow(1, 'tuyen-sinh-hutech'),
      { row: 2, source: 'tuyen-sinh-ptit.md', document_id: 'tuyen-sinh-ptit', action: 'unchanged', expected_revision: 1, errors: [], payload },
      { row: 3, source: 'scan.md', document_id: null, action: 'invalid', expected_revision: null, errors: ['File rỗng'], payload: null },
    ] });
    mocked.commitImport.mockResolvedValue({ ...report(1), rows: [
      { row: 1, document_id: 'tuyen-sinh-hutech', outcome: 'created', revision: 1, error: null },
    ] });
    renderImport();

    addFiles(new File(['# HUTECH'], 'tuyen-sinh-hutech.md', { type: 'text/markdown' }));
    expect(screen.getByText('tuyen-sinh-hutech.md')).toBeInTheDocument();
    next();
    await waitFor(() => expect(mocked.previewImport).toHaveBeenCalledWith({
      kb: 'kb1', body: { kind: 'files', files: [{ name: 'tuyen-sinh-hutech.md', content: '# HUTECH' }] },
    }));
    expect(await screen.findByText('File rỗng')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Xem trước & ghi');

    fireEvent.click(screen.getByRole('button', { name: 'Ghi 1 tài liệu' }));
    await waitFor(() => expect(mocked.commitImport).toHaveBeenCalledTimes(1));
    const body = mocked.commitImport.mock.calls[0]![0].body;
    expect(body.rows).toEqual([{ row: 1, document_id: 'tuyen-sinh-hutech', expected_revision: 0, payload }]);
    expect(body.idempotency_key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    const result = await screen.findByRole('status', { name: 'Kết quả nhập' });
    expect(within(result).getByText('Tạo').nextSibling).toHaveTextContent('1');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về danh sách tài liệu' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents');
  });

  it('reuses the idempotency key when a failed commit is retried', async () => {
    mocked.previewImport.mockResolvedValue({ rows: [createRow(1, 'a')] });
    mocked.commitImport.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce(report(1));
    renderImport();
    addFiles(new File(['# A'], 'a.md'));
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghi 1 tài liệu' }));
    expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi 1 tài liệu' }));
    await waitFor(() => expect(mocked.commitImport).toHaveBeenCalledTimes(2));
    expect(mocked.commitImport.mock.calls[1]![0].body.idempotency_key).toBe(mocked.commitImport.mock.calls[0]![0].body.idempotency_key);
  });

  it('drops the old preview when the selected files change', async () => {
    mocked.previewImport.mockResolvedValueOnce({ rows: [createRow(1, 'a')] }).mockReturnValueOnce(new Promise(() => {}));
    renderImport();

    addFiles(new File(['# A'], 'a.md'));
    next();
    expect(await screen.findByRole('button', { name: 'Ghi 1 tài liệu' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    addFiles(new File(['# B'], 'b.md'));
    next();
    await waitFor(() => expect(mocked.previewImport).toHaveBeenCalledTimes(2));
    expect(mocked.previewImport.mock.calls[1]![0].body).toEqual({ kind: 'files', files: [{ name: 'a.md', content: '# A' }, { name: 'b.md', content: '# B' }] });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi 0 tài liệu' })).toBeDisabled();
  });

  it('rejects mixed file types and oversize files before calling the API', () => {
    renderImport();
    addFiles(new File(['# A'], 'a.md'), new File(['id\n1'], 'b.csv'));
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể trộn CSV với Markdown/TXT');
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ b.csv' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    addFiles(new File(['x'.repeat(256 * 1024 + 1)], 'lon.md'));
    expect(screen.getByRole('alert')).toHaveTextContent('lon.md: lớn hơn 256 KB.');
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    expect(mocked.previewImport).not.toHaveBeenCalled();
  });

  it('auto-maps CSV columns, shows a sample and forgets the mapping when a different CSV is loaded', async () => {
    mocked.listFields.mockResolvedValue([{ id: 'f1', name: 'truong', type: 'string', label: 'Trường', filterable: true, ordinal: 0 }]);
    mocked.previewImport.mockResolvedValue({ rows: [] });
    renderImport();
    await waitFor(() => expect(mocked.listFields).toHaveBeenCalled());

    const first = 'id,Tiêu đề,body,TRUONG\n1,Học phí HUTECH,B,HUTECH';
    addFiles(new File([first], 'one.csv'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled());
    next();
    expect(screen.getByLabelText('Tiêu đề')).toHaveTextContent('Tiêu đề');
    expect(screen.getByText('Học phí HUTECH')).toBeInTheDocument();
    pick('Mã tài liệu', 'id');
    next();
    await waitFor(() => expect(mocked.previewImport).toHaveBeenCalledWith({
      kb: 'kb1', body: { kind: 'csv', content: first, mapping: { document_id: 'id', title: 'Tiêu đề', body: 'body', metadata: { truong: 'TRUONG' } } },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ one.csv' }));
    const second = 'ma,ten\n1,A';
    addFiles(new File([second], 'two.csv'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled());
    next();
    expect(screen.getByLabelText('Mã tài liệu')).toHaveTextContent('(không ghép)');
    pick('Tiêu đề', 'ten');
    next();
    await waitFor(() => expect(mocked.previewImport).toHaveBeenCalledTimes(2));
    expect(mocked.previewImport.mock.calls[1]![0].body).toEqual({ kind: 'csv', content: second, mapping: { title: 'ten', metadata: {} } });
  });

  it('filters the preview table from the summary chips', async () => {
    mocked.previewImport.mockResolvedValue({ rows: [
      createRow(1, 'a'),
      createRow(2, 'b'),
      { row: 3, source: 'c.md', document_id: 'c', action: 'invalid', expected_revision: null, errors: ['Thiếu nội dung'], payload: null },
    ] });
    renderImport();
    addFiles(new File(['# A'], 'a.md'));
    next();
    const summary = await screen.findByRole('status', { name: 'Tóm tắt xem trước' });
    expect(screen.getAllByRole('row')).toHaveLength(4);

    fireEvent.click(within(summary).getByRole('button', { name: /1 lỗi/ }));
    expect(within(summary).getByRole('button', { name: /1 lỗi/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Thiếu nội dung')).toBeInTheDocument();

    fireEvent.click(within(summary).getByRole('button', { name: /2 tạo mới/ }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByText('Thiếu nội dung')).not.toBeInTheDocument();
  });

  it('starts over with a new idempotency key after "Nhập tiếp"', async () => {
    mocked.previewImport.mockResolvedValue({ rows: [createRow(1, 'a')] });
    mocked.commitImport.mockResolvedValue(report(1));
    renderImport();
    addFiles(new File(['# A'], 'a.md'));
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghi 1 tài liệu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nhập tiếp' }));

    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Chọn file');
    expect(screen.queryByText('a.md')).not.toBeInTheDocument();
    addFiles(new File(['# A'], 'a.md'));
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Ghi 1 tài liệu' }));
    await waitFor(() => expect(mocked.commitImport).toHaveBeenCalledTimes(2));
    expect(mocked.commitImport.mock.calls[1]![0].body.idempotency_key).not.toBe(mocked.commitImport.mock.calls[0]![0].body.idempotency_key);
  });

  it('waits for the metadata fields before mapping a CSV, so auto-mapping still runs', async () => {
    let loadFields: (fields: Awaited<ReturnType<typeof knowledgeApi.listFields>>) => void = () => {};
    mocked.listFields.mockReturnValue(new Promise(resolve => { loadFields = resolve; }));
    renderImport();
    addFiles(new File(['id,TRUONG\n1,HUTECH'], 'one.csv'));
    expect(await screen.findByText('Đang tải metadata…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();

    loadFields([{ id: 'f1', name: 'truong', type: 'string', label: 'Trường', filterable: true, ordinal: 0 }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled());
    next();
    expect(screen.getByLabelText(/^Trường/)).toHaveTextContent('TRUONG');
  });
});
