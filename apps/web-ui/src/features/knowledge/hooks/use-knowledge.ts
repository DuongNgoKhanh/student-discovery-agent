'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi } from '../api/knowledge';
import type { DocumentFilters, IndexStatus } from '../types';

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  bases: () => ['knowledge', 'bases'] as const,
  base: (kb: string) => ['knowledge', 'base', kb] as const,
  fields: (kb: string) => ['knowledge', 'fields', kb] as const,
  /** Without filters this is the prefix of every page/filter of the KB, for invalidation. */
  documents: (kb: string, filters?: DocumentFilters) =>
    filters === undefined ? ['knowledge', 'documents', kb] as const : ['knowledge', 'documents', kb, filters] as const,
  document: (kb: string, doc: string) => ['knowledge', 'document', kb, doc] as const,
  agentParams: (kb: string) => ['knowledge', 'agent-params', kb] as const,
};

export const POLL_INTERVAL_MS = 3000;
export const isIndexPending = (status: IndexStatus) => status === 'pending' || status === 'indexing';
export interface PollOptions { pollWhilePending?: boolean }

export const useKnowledgeBases = () => useQuery({ queryKey: knowledgeKeys.bases(), queryFn: knowledgeApi.listBases });
export const useKnowledgeBase = (kb: string) => useQuery({ queryKey: knowledgeKeys.base(kb), queryFn: () => knowledgeApi.getBase(kb) });
export const useFields = (kb: string) => useQuery({ queryKey: knowledgeKeys.fields(kb), queryFn: () => knowledgeApi.listFields(kb) });
/** `keepPrevious` keeps the last page on screen while the next one loads (paging), instead of a skeleton. */
export const useDocuments = (
  kb: string, filters: DocumentFilters = {}, { pollWhilePending = false, keepPrevious = false }: PollOptions & { keepPrevious?: boolean } = {},
) => useQuery({
  queryKey: knowledgeKeys.documents(kb, filters),
  queryFn: () => knowledgeApi.listDocuments(kb, filters),
  placeholderData: keepPrevious ? keepPreviousData : undefined,
  refetchInterval: query =>
    pollWhilePending && query.state.data?.items.some(doc => isIndexPending(doc.index_status)) ? POLL_INTERVAL_MS : false,
});
export const useDocument = (kb: string, doc: string | null, { pollWhilePending = false }: PollOptions = {}) => useQuery({
  queryKey: knowledgeKeys.document(kb, doc ?? ''), queryFn: () => knowledgeApi.getDocument(kb, doc!), enabled: doc !== null,
  refetchInterval: query =>
    pollWhilePending && query.state.data && isIndexPending(query.state.data.latest.index_status) ? POLL_INTERVAL_MS : false,
});
export const useAgentParams = (kb: string) =>
  useQuery({ queryKey: knowledgeKeys.agentParams(kb), queryFn: () => knowledgeApi.agentParams(kb) });

/**
 * Writes refresh every knowledge query (documents, the KB and the KB list included): the admin screens are small
 * and the sidebar counts depend on document writes.
 */
function useKnowledgeWrite<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (vars: V) => mutationFn(vars), onSuccess: () => client.invalidateQueries({ queryKey: knowledgeKeys.all }) });
}

export const useCreateKnowledgeBase = () => useKnowledgeWrite(knowledgeApi.createBase);
export const useUpdateKnowledgeBase = () => useKnowledgeWrite(knowledgeApi.patchBase);
export const useCreateField = () => useKnowledgeWrite(knowledgeApi.createField);
export const usePatchField = () => useKnowledgeWrite(knowledgeApi.patchField);
export const useDeleteField = () => useKnowledgeWrite(knowledgeApi.deleteField);
export const usePutDocument = () => useKnowledgeWrite(knowledgeApi.putDocument);
export const useArchiveDocument = () => useKnowledgeWrite(knowledgeApi.archiveDocument);
export const useRestoreDocument = () => useKnowledgeWrite(knowledgeApi.restoreDocument);
export const useRetryRevision = () => useKnowledgeWrite(knowledgeApi.retryRevision);
export const useCommitImport = () => useKnowledgeWrite(knowledgeApi.commitImport);
export const usePreviewImport = () => useMutation({ mutationFn: (vars: Parameters<typeof knowledgeApi.previewImport>[0]) => knowledgeApi.previewImport(vars) });
export const useSearchKnowledge = () => useMutation({ mutationFn: (vars: Parameters<typeof knowledgeApi.search>[0]) => knowledgeApi.search(vars) });
