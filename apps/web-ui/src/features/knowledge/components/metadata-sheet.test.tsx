import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '@/test/render';
import { ApiError } from '@/lib/api/errors';
import { knowledgeApi } from '../api/knowledge';
import type { MetadataField } from '../types';
import { fieldName } from './metadata-field-form';
import { MetadataSheet } from './metadata-sheet';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { listFields: vi.fn(), createField: vi.fn(), patchField: vi.fn(), deleteField: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);
// Radix Switch measures itself inside a <form>; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const fields: MetadataField[] = [
  { id: 'f2', name: 'hoc_phi', type: 'number', label: 'Học phí', filterable: false, ordinal: 3 },
  { id: 'f1', name: 'truong', type: 'string', label: 'Trường', filterable: true, ordinal: 0 },
];

const openSheet = async () => {
  render(<TestProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MetadataSheet kb="kb1" /></TestProviders>);
  fireEvent.click(screen.getByRole('button', { name: 'Metadata' }));
  await screen.findByText('hoc_phi');
};

describe('MetadataSheet', () => {
  beforeEach(() => { vi.resetAllMocks(); mocked.listFields.mockResolvedValue(fields); });

  it('suggests a technical name from the label and appends the new field', async () => {
    mocked.createField.mockResolvedValue({ id: 'f3', name: 'nganh_dao_tao', type: 'string', label: 'Ngành đào tạo', filterable: false, ordinal: 4 });
    await openSheet();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Trường');
    expect(items[1]).toHaveTextContent('số');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm trường' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Ngành đào tạo' } });
    expect(screen.getByLabelText('Tên kỹ thuật')).toHaveValue('nganh_dao_tao');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    await waitFor(() => expect(mocked.createField).toHaveBeenCalledWith({
      kb: 'kb1', body: { name: 'nganh_dao_tao', type: 'string', label: 'Ngành đào tạo', filterable: false, ordinal: 4 },
    }));
  });

  it('explains why a field still in use cannot be deleted', async () => {
    mocked.deleteField.mockRejectedValue(new ApiError({
      code: 'CONFLICT_RESOURCE_IN_USE', message: 'Field is still used by active documents', httpStatus: 409, details: { kind: 'field_in_use', documents: 3 },
    }));
    await openSheet();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Thao tác cho trường Học phí' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Xoá' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá' }));
    expect(await screen.findByText(/Còn 3 tài liệu đang dùng trường này/)).toBeInTheDocument();
    expect(mocked.deleteField).toHaveBeenCalledWith({ kb: 'kb1', name: 'hoc_phi' });
    expect(screen.getByRole('link', { name: 'Xem tài liệu' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents');
  });

  it('builds field names that satisfy the server pattern', () => {
    expect(fieldName('Học phí 2026')).toBe('hoc_phi_2026');
    expect(fieldName('2026 điểm chuẩn')).toBe('diem_chuan');
  });
});
