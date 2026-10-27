// Public surface của feature knowledge (admin quản lý knowledge base).
export * from './types';
export { knowledgeApi } from './api/knowledge';
export * from './hooks/use-knowledge';
export { KnowledgeBaseList } from './components/knowledge-base-list';
export { KnowledgeBaseShell, activeSection, kbHref, KB_SECTIONS, type KnowledgeBaseSection } from './components/knowledge-base-shell';
export { KnowledgeDocumentsPage } from './components/knowledge-documents-page';
export { KnowledgeImportPage } from './components/knowledge-import-page';
export { KnowledgeTestingPage } from './components/knowledge-testing-page';
export { KnowledgeSettings } from './components/knowledge-settings';
export { DocumentEditor } from './components/document-editor';
export * from './components/shared';
