import { randomUUID } from 'node:crypto';

export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

const MAX_DOCUMENT_ID = 64;

/** Candidate ids for a document whose plain id is taken by another KB: `<kb>-<id>`, then `-2`, `-3`, ... (max 64 chars). */
export function* prefixedDocumentIds(kbId: string, documentId: string): Generator<string> {
  const stem = `${kbId}-${documentId}`;
  yield stem.slice(0, MAX_DOCUMENT_ID).replace(/[-_]+$/, '');
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    yield `${stem.slice(0, MAX_DOCUMENT_ID - suffix.length).replace(/[-_]+$/, '')}${suffix}`;
  }
}
