import catalog from '../../../generated/agent-tool-catalog.json';

export type ToolParams = 'none' | 'json' | 'knowledge.search' | 'knowledge.show';

const EDITORS: readonly ToolParams[] = ['none', 'json', 'knowledge.search', 'knowledge.show'];

/** The runtime's tool catalog (pnpm gen:api copies contracts/fixtures/agent-tool-catalog.json). Unknown tools in a
 * config stay read-only; an editor this UI does not know falls back to the JSON editor. */
export const TOOL_CATALOG: { name: string; version: number; label: string; description: string; params: ToolParams }[] =
  catalog.tools.map(tool => ({
    name: tool.name,
    version: tool.version,
    label: tool.label,
    description: tool.summary,
    params: (EDITORS as readonly string[]).includes(tool.editor) ? (tool.editor as ToolParams) : 'json',
  }));

export type ToolBinding = { name: string; version: number; params?: Record<string, unknown> };

/**
 * Bind the knowledge tools to a knowledge base using the params it suggests (applied at apply time on current state).
 * The KB id and filter fields come from the suggestion; other search tuning already set (top_k, score_threshold, …) is kept.
 * knowledge.show is dropped when the KB suggests no display fields — an empty card would fail validation.
 */
export function bindKnowledge(tools: ToolBinding[], params: Record<string, unknown>): ToolBinding[] {
  const existing = tools.find(t => t.name === 'knowledge.search')?.params ?? {};
  const suggestedSearch = (params['knowledge.search'] ?? {}) as Record<string, unknown>;
  // Without a KB id the binding could only fail validation; keep what the admin already has.
  if (typeof suggestedSearch.knowledge_base_id !== 'string' || !suggestedSearch.knowledge_base_id) return tools;
  const kept = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== 'knowledge_base_id' && key !== 'auto_filter_fields'));
  const search: ToolBinding = { name: 'knowledge.search', version: 1, params: { ...suggestedSearch, ...kept,
    knowledge_base_id: suggestedSearch.knowledge_base_id, auto_filter_fields: suggestedSearch.auto_filter_fields ?? [] } };
  const show = params['knowledge.show'] as { display?: unknown } | undefined;
  const rest = tools.filter(t => t.name !== 'knowledge.search' && t.name !== 'knowledge.show');
  return Array.isArray(show?.display) && show.display.length
    ? [...rest, search, { name: 'knowledge.show', version: 1, params: show as Record<string, unknown> }]
    : [...rest, search];
}
