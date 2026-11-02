import { FileText, Settings, Target } from 'lucide-react';

export const KB_SECTIONS = [
  { slug: 'documents', label: 'Tài liệu', icon: FileText },
  { slug: 'testing', label: 'Thử truy xuất', icon: Target },
  { slug: 'settings', label: 'Cài đặt', icon: Settings },
] as const;
export type KnowledgeBaseSection = (typeof KB_SECTIONS)[number]['slug'];

export const kbHref = (kb: string, path = '') => `/admin/knowledge/${encodeURIComponent(kb)}${path ? `/${path}` : ''}`;

/** The section is the first path segment after /admin/knowledge/[kb]; the document editor belongs to "documents". */
export function activeSection(pathname: string): KnowledgeBaseSection | undefined {
  const segment = pathname.split('/')[4];
  return KB_SECTIONS.find(section => section.slug === segment)?.slug;
}
