'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi } from '../api/knowledge';

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  bases: () => ['knowledge', 'bases'] as const,
  base: (kb: string) => ['knowledge', 'base', kb] as const,
  fields: (kb: string) => ['knowledge', 'fields', kb] as const,
  documents: (kb: string) => ['knowledge', 'documents', kb] as const,
  document: (kb: string, doc: string) => ['knowledge', 'document', kb, doc] as const,
  agentParams: (kb: string) => ['knowledge', 'agent-params', kb] as const,
};

export const useKnowledgeBases = () => useQuery({ queryKey: knowledgeKeys.bases(), queryFn: knowledgeApi.listBases });
export const useKnowledgeBase = (kb: string) => useQuery({ queryKey: knowledgeKeys.base(kb), queryFn: () => knowledgeApi.getBase(kb) });
export const useFields = (kb: string) => useQuery({ queryKey: knowledgeKeys.fields(kb), queryFn: () => knowledgeApi.listFields(kb) });
export const useDocuments = (kb: string) =>
  useQuery({ queryKey: knowledgeKeys.documents(kb), queryFn: () => knowledgeApi.listDocuments(kb) });
export const useDocument = (kb: string, doc: string | null) => useQuery({
  queryKey: knowledgeKeys.document(kb, doc ?? ''), queryFn: () => knowledgeApi.getDocument(kb, doc!), enabled: doc !== null,
});
export const useAgentParams = (kb: string) =>
  useQuery({ queryKey: knowledgeKeys.agentParams(kb), queryFn: () => knowledgeApi.agentParams(kb) });

/** Writes refresh every knowledge query: the admin screens are small and counts/badges depend on each other. */
function useKnowledgeWrite<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (vars: V) => mutationFn(vars), onSuccess: () => client.invalidateQueries({ queryKey: knowledgeKeys.all }) });
}

export const useCreateKnowledgeBase = () => useKnowledgeWrite(knowledgeApi.createBase);
export const useCreateField = () => useKnowledgeWrite(knowledgeApi.createField);
export const usePatchField = () => useKnowledgeWrite(knowledgeApi.patchField);
export const useDeleteField = () => useKnowledgeWrite(knowledgeApi.deleteField);
export const usePutDocument = () => useKnowledgeWrite(knowledgeApi.putDocument);
export const useArchiveDocument = () => useKnowledgeWrite(knowledgeApi.archiveDocument);
export const useRestoreDocument = () => useKnowledgeWrite(knowledgeApi.restoreDocument);
export const useRetryRevision = () => useKnowledgeWrite(knowledgeApi.retryRevision);
export const useCommitImport = () => useKnowledgeWrite(knowledgeApi.commitImport);
export const usePreviewImport = () => useMutation({ mutationFn: knowledgeApi.previewImport });
export const useSearchKnowledge = () => useMutation({ mutationFn: knowledgeApi.search });
