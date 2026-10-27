import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { knowledgeApi } from '../api/knowledge';
import { KnowledgeTestingPage } from './knowledge-testing-page';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { search: vi.fn(), listFields: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);
const fields = [{ id: 'f1', name: 'school', type: 'string' as const, label: 'Trường', filterable: true, ordinal: 0 }];
const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><KnowledgeTestingPage kb="kb1" /></QueryClientProvider>);

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
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(mocked.search).toHaveBeenCalledWith({ kb: 'kb1', body: { query: 'hoc phi', top_k: 4 } }));
    expect(await screen.findByText('1 đoạn')).toBeInTheDocument();
    expect(screen.getByText('0.812')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Học phí HUTECH' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents/hutech-fee');
    expect(screen.getByText('Đang chỉ tìm theo từ khoá (embedding câu hỏi lỗi).')).toBeInTheDocument();
    expect(screen.getByText('Trường: HUTECH · r3')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không có đoạn nào vượt ngưỡng.')).toBeInTheDocument();
    expect(mocked.search).toHaveBeenCalledTimes(2);
  });
});
