export type ToolParams = 'none' | 'json' | 'knowledge.search' | 'knowledge.show';

/** Tools the runtime catalog declares (agent/catalog.py). Unknown tools in a config stay read-only. */
export const TOOL_CATALOG: { name: string; version: 1; label: string; description: string; params: ToolParams }[] = [
  { name: 'assessment.start', version: 1, label: 'Bắt đầu bài khám phá', description: 'Mở bài khám phá tính cách khi học sinh muốn làm bài.', params: 'json' },
  { name: 'assessment.set_name', version: 1, label: 'Lưu tên học sinh', description: 'Ghi tên học sinh trước khi làm bài.', params: 'none' },
  { name: 'assessment.current_question', version: 1, label: 'Hiện lại câu hỏi', description: 'Hiển thị lại câu hỏi đang làm.', params: 'none' },
  { name: 'assessment.propose_answer', version: 1, label: 'Đề xuất đáp án', description: 'Hiểu câu trả lời tự do và hỏi lại để xác nhận.', params: 'none' },
  { name: 'result.explain', version: 1, label: 'Giải thích kết quả', description: 'Đọc kết quả bài khám phá để giải thích.', params: 'none' },
  { name: 'ui.suggest_replies', version: 1, label: 'Gợi ý trả lời nhanh', description: 'Hiện tối đa 4 nút gợi ý.', params: 'none' },
  { name: 'knowledge.search', version: 1, label: 'Tìm trong Knowledge Base', description: 'Tra cứu thông tin tuyển sinh trong KB đã chọn.', params: 'knowledge.search' },
  { name: 'knowledge.show', version: 1, label: 'Hiện thẻ thông tin', description: 'Dựng thẻ từ kết quả tìm kiếm (cần bật Tìm trong KB).', params: 'knowledge.show' },
];
