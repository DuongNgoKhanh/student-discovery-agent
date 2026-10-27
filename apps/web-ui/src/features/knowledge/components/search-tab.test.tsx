import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '@/test/render';
import { ApiError } from '@/lib/api/errors';
import { knowledgeApi } from '../api/knowledge';
import { DEFAULT_SETTINGS } from './build-search-request';
import { KnowledgeTestingPage } from './knowledge-testing-page';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { search: vi.fn(), listFields: vi.fn(), getDocument: vi.fn() } }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const mocked = vi.mocked(knowledgeApi);
const fields = [{ id: 'f1', name: 'school', type: 'string' as const, label: 'Trường', filterable: true, ordinal: 0 }];
const renderPage = () => render(<TestProviders client={new QueryClient()}><KnowledgeTestingPage kb="kb1" /></TestProviders>);

describe('KnowledgeTestingPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    mocked.listFields.mockResolvedValue(fields);
  });

  it('sends the query with Ctrl+Enter, renders highlighted cards, the degraded line and history', async () => {
    mocked.search.mockResolvedValue({
      degraded: true,
      records: [{ content: 'Học phí ngành CNTT là 42 triệu/năm.', score: 0.8123, title: 'Học phí HUTECH',
        metadata: { document_id: 'hutech-fee', revision: 3, chunk: 0, school: 'HUTECH' } }],
    });
    renderPage();
    expect(screen.getByText('Nhập câu hỏi để xem agent sẽ đọc được gì')).toBeInTheDocument();
    const box = screen.getByLabelText('Câu hỏi');
    fireEvent.change(box, { target: { value: 'hoc phi' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm' })).toBeEnabled());
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(mocked.search).toHaveBeenCalledWith({ kb: 'kb1', body: { query: 'hoc phi', top_k: 4 } }));
    expect(await screen.findByText(/^1 kết quả · \d+ ms \(đo tại trình duyệt\) · Chế độ: Chỉ từ khoá$/)).toBeInTheDocument();
    const item = within(screen.getByRole('listitem', { name: '#1 Học phí HUTECH' }));
    expect(item.getByText('#1')).toBeInTheDocument();
    expect(item.getByText('Chunk #0 · r3')).toBeInTheDocument();
    expect(item.getByText('Điểm kết hợp')).toBeInTheDocument();
    expect(item.getByText('0.812')).toBeInTheDocument();
    expect(item.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText('Đang chỉ tìm theo từ khoá (embedding câu hỏi lỗi).')).toBeInTheDocument();
    expect(screen.getByText('Trường: HUTECH')).toBeInTheDocument();
    const card = within(screen.getByRole('list', { name: 'Kết quả truy xuất' }));
    expect(card.getByText('Học', { selector: 'mark' })).toBeInTheDocument();

    const history = within(screen.getByRole('region', { name: 'Gần đây' }));
    fireEvent.click(history.getByRole('button', { name: /hoc phi/ }));
    await waitFor(() => expect(mocked.search).toHaveBeenCalledTimes(2));
    expect(JSON.parse(window.localStorage.getItem('knowledge.search-history.kb1') ?? '[]')).toHaveLength(1);
  });

  it('says when nothing passes the threshold and retries after a 503', async () => {
    mocked.search
      .mockRejectedValueOnce(new ApiError({ code: 'SYS_UNAVAILABLE', message: 'unavailable', httpStatus: 503 }))
      .mockResolvedValueOnce({ degraded: false, records: [] });
    renderPage();
    fireEvent.change(screen.getByLabelText('Câu hỏi'), { target: { value: 'điểm chuẩn' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không có đoạn nào vượt ngưỡng.')).toBeInTheDocument();
    expect(screen.getByText(/Chế độ: Kết hợp ngữ nghĩa \+ từ khoá/)).toBeInTheDocument();
    expect(mocked.search).toHaveBeenCalledTimes(2);
  });

  it('waits for the fields before searching and says which conditions are not applied', async () => {
    let loadFields: (value: typeof fields) => void = () => {};
    mocked.listFields.mockReturnValue(new Promise(resolve => { loadFields = resolve; }));
    mocked.search.mockResolvedValue({ degraded: false, records: [] });
    const settings = { ...DEFAULT_SETTINGS, conditions: [
      { id: 'a', name: 'school', operator: 'is', value: 'HUTECH' }, { id: 'b', name: 'school', operator: 'is', value: ' ' },
    ] };
    window.localStorage.setItem('knowledge.search-history.kb1', JSON.stringify([{ query: 'q', settings, at: '2026-10-27T00:00:00Z' }]));
    renderPage();
    fireEvent.change(screen.getByLabelText('Câu hỏi'), { target: { value: 'q' } });
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeDisabled();

    loadFields(fields);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^q/ }));
    expect(await screen.findByText('1 điều kiện chưa đầy đủ nên không được áp dụng.')).toBeInTheDocument();
    await waitFor(() => expect(mocked.search).toHaveBeenCalledWith({ kb: 'kb1', body: {
      query: 'q', top_k: 4, metadata_condition: { logical_operator: 'and', conditions: [{ name: 'school', comparison_operator: 'is', value: 'HUTECH' }] },
    } }));
  });

  it('measures the round trip in the browser and opens the source sheet with the retrieved chunk', async () => {
    // The clock only moves while the request is in flight, whoever else reads it.
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    mocked.search.mockImplementation(async () => {
      now += 123;
      return {
        degraded: false,
        records: [
          { content: 'Học phí ngành CNTT là 42 triệu/năm.', score: 0.71, title: 'Học phí HUTECH', metadata: { document_id: 'hutech-fee', revision: 2, chunk: 5 } },
          { content: 'Không rõ nguồn.', score: 0.4, title: 'Mồ côi', metadata: {} },
        ],
      };
    });
    mocked.getDocument.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/không sinh câu trả lời AI/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Câu hỏi'), { target: { value: 'hoc phi' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tìm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));

    expect(await screen.findByText('2 kết quả · 123 ms (đo tại trình duyệt) · Chế độ: Kết hợp ngữ nghĩa + từ khoá')).toBeInTheDocument();
    vi.mocked(performance.now).mockRestore();
    expect(within(screen.getByRole('listitem', { name: '#2 Mồ côi' })).getByRole('button', { name: 'Xem nguồn' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('listitem', { name: '#1 Học phí HUTECH' })).getByRole('button', { name: 'Xem nguồn' }));

    const sheet = within(await screen.findByRole('dialog'));
    const block = sheet.getByText('Đoạn được truy xuất').closest('section')!;
    expect(within(block).getByText('Chunk #5 · r2 · 0.710')).toBeInTheDocument();
    expect(within(block).getByText('phí', { selector: 'mark' })).toBeInTheDocument();
    await waitFor(() => expect(mocked.getDocument).toHaveBeenCalledWith('kb1', 'hutech-fee'));
  });

  it('suggests loosening the settings when a narrowed search finds nothing', async () => {
    mocked.search.mockResolvedValue({ degraded: false, records: [] });
    const settings = { ...DEFAULT_SETTINGS, scoreThreshold: 0.3 };
    window.localStorage.setItem('knowledge.search-history.kb1', JSON.stringify([{ query: 'q', settings, at: '2026-10-27T00:00:00Z' }]));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /^q/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^q/ }));
    expect(await screen.findByText(/Thử hạ ngưỡng điểm/)).toBeInTheDocument();
    expect(screen.getByText('Top 4 · ngưỡng 0.30')).toBeInTheDocument();
  });
});
