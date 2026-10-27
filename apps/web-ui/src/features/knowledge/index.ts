// Public surface của feature knowledge (admin quản lý knowledge base).
export * from './types';
export { knowledgeApi } from './api/knowledge';
export * from './hooks/use-knowledge';
export { KnowledgeBaseList } from './components/knowledge-base-list';
export { activeSection, kbHref, KB_SECTIONS, type KnowledgeBaseSection } from './components/kb-routes';
export { KnowledgeBaseBreadcrumb, KnowledgeBaseNav } from './components/knowledge-base-nav';
export { DocumentDetailSheet, type DocumentDetailSheetProps } from './components/document-detail-sheet';
export { KnowledgeDocumentsPage } from './components/knowledge-documents-page';
export { KnowledgeImportPage } from './components/knowledge-import-page';
export { KnowledgeTestingPage } from './components/knowledge-testing-page';
export { KnowledgeSettings } from './components/knowledge-settings';
export { DocumentEditor } from './components/document-editor';
export * from './components/shared';
// Both `./types` and the shared component export `IndexStatus` (type vs type + component); this one wins.
export { IndexStatus } from './components/shared/index-status';
