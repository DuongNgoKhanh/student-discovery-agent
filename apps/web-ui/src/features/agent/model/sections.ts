import type { AgentConfig } from '../types';
import { canonical, parsePath } from './config';

export type AgentMode = 'agent' | 'chatflow';
export type SectionId = 'persona' | 'model' | 'tools' | 'limits' | 'templates' | 'chatflow' | 'json';

const AGENT_SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'persona', label: 'Lời chào & persona' },
  { id: 'model', label: 'Model' },
  { id: 'tools', label: 'Tools & Knowledge' },
  { id: 'limits', label: 'Giới hạn & an toàn' },
  { id: 'templates', label: 'Mẫu câu' },
  { id: 'json', label: 'JSON' },
];

const CHATFLOW_SECTION: { id: SectionId; label: string } = { id: 'chatflow', label: 'Chatflow' };

export const SECTIONS = AGENT_SECTIONS;
export const ALL_SECTIONS: { id: SectionId; label: string }[] = [CHATFLOW_SECTION, ...AGENT_SECTIONS];

export function sectionsForMode(mode: AgentMode): { id: SectionId; label: string }[] {
  return mode === 'chatflow' ? [CHATFLOW_SECTION, ...AGENT_SECTIONS.filter(section => section.id !== 'json')] : AGENT_SECTIONS;
}

export function sectionLabel(id: SectionId): string {
  return ALL_SECTIONS.find(section => section.id === id)?.label ?? 'JSON';
}

const BY_KEY: Record<string, SectionId> = {
  greeting_text: 'persona', greeting_suggestions: 'persona', persona: 'persona', model: 'model', tools: 'tools',
  limits: 'limits', guardrails: 'limits', links: 'limits', templates: 'templates',
  workflow: 'chatflow',
};

export const sectionOf = (path: string): SectionId => BY_KEY[String(parsePath(path)[0] ?? '')] ?? 'json';

export function changedSections(before: AgentConfig, after: AgentConfig): SectionId[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = new Set<SectionId>();
  for (const key of keys) if (canonical(before[key]) !== canonical(after[key])) changed.add(BY_KEY[key] ?? 'json');
  return ALL_SECTIONS.map(s => s.id).filter(id => changed.has(id));
}
