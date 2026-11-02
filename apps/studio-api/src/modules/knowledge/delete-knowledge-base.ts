import { getProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import { inKnowledgeTransaction } from '@/infrastructure/db/knowledge-client';
import { getActive, getDraft, insertAudit } from '@/modules/agent/agent.repository';
import { requireKnowledgeBase } from '@/modules/knowledge/knowledge.service';

/** True when any object in the agent config points `knowledge_base_id` at this KB (knowledge.search params). */
function referencesKnowledgeBase(node: unknown, kbId: string): boolean {
  if (Array.isArray(node)) return node.some(item => referencesKnowledgeBase(item, kbId));
  if (node === null || typeof node !== 'object') return false;
  return Object.entries(node).some(([key, value]) =>
    (key === 'knowledge_base_id' && value === kbId) || referencesKnowledgeBase(value, kbId));
}

async function agentUsage(kbId: string): Promise<Array<'active_release' | 'draft'>> {
  const db = getProductDatabase();
  const where: Array<'active_release' | 'draft'> = [];
  const active = await getActive(db);
  if (active && referencesKnowledgeBase(active.release.content, kbId)) where.push('active_release');
  const draft = await getDraft(db);
  if (draft && referencesKnowledgeBase(draft.content, kbId)) where.push('draft');
  return where;
}

/** Deletes the KB and, by cascade, its fields, documents, revisions, chunks and imports (the embedding cache stays). */
export async function deleteKnowledgeBase(kbId: string, actor: string): Promise<{ id: string; deleted: true }> {
  const { name, documentCount } = await inKnowledgeTransaction(async client => {
    const kb = await requireKnowledgeBase(client, kbId);
    const where = await agentUsage(kbId);
    if (where.length > 0) {
      throw new ProductError(409, 'CONFLICT_RESOURCE_IN_USE', 'Knowledge base is used by the agent', false, { kind: 'in_use', where });
    }
    await client.query('DELETE FROM knowledge.knowledge_bases WHERE id = $1', [kbId]);
    return { name: kb.name, documentCount: kb.document_count };
  });
  await insertAudit(getProductDatabase(), {
    actor, action: 'knowledge_base.delete', target_kind: 'knowledge_base', target_id: kbId,
    before_ref: null, after_ref: null, outcome: 'success', details: { name, document_count: documentCount },
  });
  return { id: kbId, deleted: true };
}
