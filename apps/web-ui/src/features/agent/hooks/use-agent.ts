'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentApi } from '../api/agent';

export const agentKeys = {
  all: ['agent'] as const,
  draft: () => ['agent', 'draft'] as const,
  active: () => ['agent', 'active'] as const,
  releases: (cursor: string | null) => ['agent', 'releases', cursor] as const,
  release: (id: string) => ['agent', 'release', id] as const,
  audit: (cursor: string | null) => ['agent', 'audit', cursor] as const,
};

/** Idempotency key for one user action; reused only when retrying that same action. */
export const actionKey = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`}`;

// No focus refetch: the editor keeps its own copy and conflicts are detected on save.
export const useAgentDraft = () => useQuery({ queryKey: agentKeys.draft(), queryFn: agentApi.getDraft, refetchOnWindowFocus: false });
export const useAgentActive = () => useQuery({ queryKey: agentKeys.active(), queryFn: agentApi.getActive });
export const useAgentReleases = (cursor: string | null) =>
  useQuery({ queryKey: agentKeys.releases(cursor), queryFn: () => agentApi.listReleases(cursor), placeholderData: keepPreviousData });
export const useAgentRelease = (id: string | null) =>
  useQuery({ queryKey: agentKeys.release(id ?? ''), queryFn: () => agentApi.getRelease(id!), enabled: id !== null });
export const useAgentAudit = (cursor: string | null) =>
  useQuery({ queryKey: agentKeys.audit(cursor), queryFn: () => agentApi.listAudit(cursor), placeholderData: keepPreviousData });

function useAgentWrite<V, R>(fn: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (vars: V) => fn(vars), onSuccess: () => client.invalidateQueries({ queryKey: agentKeys.all }) });
}
export const useSaveDraft = () => useAgentWrite(agentApi.saveDraft);
export const usePublish = () => useAgentWrite(agentApi.publish);
export const useRestore = () => useAgentWrite(agentApi.restore);
// Validation reads only; it must not refetch the draft the admin is editing.
export const useValidateDraft = () => useMutation({ mutationFn: () => agentApi.validate() });
