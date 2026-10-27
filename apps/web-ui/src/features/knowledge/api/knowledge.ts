import { api } from '@/lib/api/client';
import type {
  AgentParams, DocumentDetail, DocumentPut, DocumentSummary, DocumentWriteResult, FieldCreate, FieldPatch,
  ImportCommitRequest, ImportPreview, ImportPreviewRequest, ImportReport, KnowledgeBase, KnowledgeBaseCreate,
  MetadataField, SearchRequest, SearchResult,
} from '../types';

const base = (kb: string) => `admin/knowledge-bases/${encodeURIComponent(kb)}`;
const document = (kb: string, doc: string) => `${base(kb)}/documents/${encodeURIComponent(doc)}`;

export const knowledgeApi = {
  listBases: async () => (await api.get<{ items: KnowledgeBase[] }>('admin/knowledge-bases')).items,
  createBase: (body: KnowledgeBaseCreate) => api.post<KnowledgeBase>('admin/knowledge-bases', body),
  getBase: (kb: string) => api.get<KnowledgeBase>(base(kb)),
  listFields: async (kb: string) => (await api.get<{ items: MetadataField[] }>(`${base(kb)}/fields`)).items,
  createField: ({ kb, body }: { kb: string; body: FieldCreate }) => api.post<MetadataField>(`${base(kb)}/fields`, body),
  patchField: ({ kb, name, body }: { kb: string; name: string; body: FieldPatch }) =>
    api.patch<MetadataField>(`${base(kb)}/fields/${name}`, body),
  deleteField: ({ kb, name }: { kb: string; name: string }) => api.del<{ name: string; deleted: true }>(`${base(kb)}/fields/${name}`),
  listDocuments: async (kb: string) => (await api.get<{ items: DocumentSummary[] }>(`${base(kb)}/documents?limit=100`)).items,
  getDocument: (kb: string, doc: string) => api.get<DocumentDetail>(document(kb, doc)),
  putDocument: ({ kb, doc, body }: { kb: string; doc: string; body: DocumentPut }) =>
    api.put<DocumentWriteResult>(document(kb, doc), body),
  archiveDocument: ({ kb, doc, expected_revision }: { kb: string; doc: string; expected_revision: number }) =>
    api.post<DocumentDetail>(`${document(kb, doc)}/archive`, { expected_revision }),
  restoreDocument: ({ kb, doc, expected_revision }: { kb: string; doc: string; expected_revision: number }) =>
    api.post<DocumentDetail>(`${document(kb, doc)}/restore`, { expected_revision }),
  retryRevision: ({ kb, doc, revision }: { kb: string; doc: string; revision: number }) =>
    api.post<DocumentDetail>(`${document(kb, doc)}/revisions/${revision}/retry`),
  previewImport: ({ kb, body }: { kb: string; body: ImportPreviewRequest }) =>
    api.post<ImportPreview>(`${base(kb)}/imports/preview`, body),
  commitImport: ({ kb, body }: { kb: string; body: ImportCommitRequest }) => api.post<ImportReport>(`${base(kb)}/imports`, body),
  search: ({ kb, body }: { kb: string; body: SearchRequest }) => api.post<SearchResult>(`${base(kb)}/search`, body),
  agentParams: (kb: string) => api.get<AgentParams>(`${base(kb)}/agent-params`),
};
