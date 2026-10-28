import { computeContentHash } from '@/modules/experiences/canonical';

/** Same JCS + SHA-256 as agent_runtime.knowledge.hashing.content_hash; metadata is keyed by field id. */
export function knowledgeContentHash(
  title: string,
  body: string,
  sourceUrl: string | null,
  storedMetadata: Record<string, unknown>,
): string {
  return computeContentHash({ title, body, source_url: sourceUrl, metadata: storedMetadata });
}
