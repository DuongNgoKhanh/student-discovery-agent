export type ImportMode = 'files' | 'csv';

/** Server limits (spec §5): rows per request, whole request, one document body. */
export const MAX_ROWS = 200;
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
export const MAX_BODY_BYTES = 256 * 1024;
export const ACCEPT = '.md,.markdown,.txt,.csv';

const TEXT_EXT = /\.(md|markdown|txt)$/i;
const CSV_EXT = /\.csv$/i;

export const formatSize = (bytes: number) => `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString('vi-VN')} KB`;

// FileReader instead of File.text(): jsdom lacks the latter and its File is not a Node Blob.
export const readText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
});

/** Mode from the file extensions plus every problem the client can catch before calling the API. */
export function checkFiles(files: File[]): { mode: ImportMode | null; errors: string[] } {
  const errors: string[] = [];
  const unsupported = files.filter(file => !TEXT_EXT.test(file.name) && !CSV_EXT.test(file.name));
  for (const file of unsupported) errors.push(`${file.name}: chỉ nhận file .md, .txt hoặc .csv.`);
  const csv = files.filter(file => CSV_EXT.test(file.name));
  const text = files.filter(file => TEXT_EXT.test(file.name));
  let mode: ImportMode | null = null;
  if (csv.length > 0 && text.length > 0) errors.push('Không thể trộn CSV với Markdown/TXT trong một lần nhập.');
  else if (csv.length > 1) errors.push('Mỗi lần chỉ nhập được một file CSV.');
  else if (csv.length === 1) mode = 'csv';
  else if (text.length > 0) mode = 'files';

  if (mode === 'files' && text.length > MAX_ROWS) errors.push(`Tối đa ${MAX_ROWS} file mỗi lần nhập (đang chọn ${text.length}).`);
  for (const file of text) {
    if (file.size > MAX_BODY_BYTES) errors.push(`${file.name}: lớn hơn ${formatSize(MAX_BODY_BYTES)}.`);
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) errors.push(`Tổng dung lượng ${formatSize(total)} vượt giới hạn 5 MB.`);
  return { mode: errors.length > 0 ? null : mode, errors };
}
