import type { AgentConfig } from '../types';
import { canonical, parsePath } from './config';

export type SectionId = 'persona' | 'model' | 'tools' | 'limits' | 'templates' | 'json';

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'persona', label: 'Lời chào & persona' },
  { id: 'model', label: 'Model' },
  { id: 'tools', label: 'Tools & Knowledge' },
  { id: 'limits', label: 'Giới hạn & an toàn' },
  { id: 'templates', label: 'Mẫu câu' },
  { id: 'json', label: 'JSON' },
];

const BY_KEY: Record<string, SectionId> = {
  greeting_text: 'persona', greeting_suggestions: 'persona', persona: 'persona', model: 'model', tools: 'tools',
  limits: 'limits', guardrails: 'limits', links: 'limits', templates: 'templates',
};

export const sectionOf = (path: string): SectionId => BY_KEY[String(parsePath(path)[0] ?? '')] ?? 'json';

export function changedSections(before: AgentConfig, after: AgentConfig): SectionId[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = new Set<SectionId>();
  for (const key of keys) if (canonical(before[key]) !== canonical(after[key])) changed.add(BY_KEY[key] ?? 'json');
  return SECTIONS.map(s => s.id).filter(id => changed.has(id));
}
