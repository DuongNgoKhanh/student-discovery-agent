/** Limits mirror agent_runtime.agent.catalog (KnowledgeShowParams / KnowledgeSearchParams). */
export const MAX_DISPLAY_FIELDS = 8;
export const MAX_AUTO_FILTER_FIELDS = 10;
export const MAX_DISPLAY_LABEL = 60;

export interface AgentParamField {
  name: string;
  label: string;
  filterable: boolean;
  ordinal: number;
}

export interface AgentParamsDTO {
  'knowledge.search': { knowledge_base_id: string; top_k: number; auto_filter_fields: string[] };
  'knowledge.show': { display: Array<{ field: string; label: string }> };
  warnings: string[];
}

/** Pure mapping from a KB's fields to params the runtime's agent.json validation accepts. */
export function buildAgentParams(kbId: string, fields: readonly AgentParamField[]): AgentParamsDTO {
  const ordered = [...fields].sort((a, b) => a.ordinal - b.ordinal || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const warnings: string[] = [];

  const shown = ordered.slice(0, MAX_DISPLAY_FIELDS);
  if (ordered.length === 0) warnings.push('KB chưa có field nào: knowledge.show cần ít nhất 1 field.');
  else if (ordered.length > shown.length) warnings.push(`Chỉ hiển thị ${MAX_DISPLAY_FIELDS} field đầu tiên theo thứ tự.`);

  let truncated = 0;
  const display = shown.map(field => {
    const trimmed = field.label.trim();
    if (trimmed.length > MAX_DISPLAY_LABEL) truncated += 1;
    const label = trimmed.slice(0, MAX_DISPLAY_LABEL).trim();
    return { field: field.name, label: label || field.name };
  });
  if (truncated > 0) warnings.push(`${truncated} nhãn dài hơn ${MAX_DISPLAY_LABEL} ký tự đã bị cắt bớt.`);

  const filterable = ordered.filter(field => field.filterable);
  if (filterable.length > MAX_AUTO_FILTER_FIELDS) {
    warnings.push(`Chỉ dùng ${MAX_AUTO_FILTER_FIELDS} field lọc được đầu tiên cho auto_filter_fields.`);
  }

  return {
    'knowledge.search': {
      knowledge_base_id: kbId, top_k: 4, auto_filter_fields: filterable.slice(0, MAX_AUTO_FILTER_FIELDS).map(field => field.name),
    },
    'knowledge.show': { display },
    warnings,
  };
}
