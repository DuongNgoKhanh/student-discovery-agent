import 'server-only';
import type { ProductDatabase } from '../db/client';
import { ProductError } from '../http/errors';
import { findCurrentVersion, insertCurrentVersion, type VersionRow } from './versions.repository';
import type { VersionCreate, VersionResponse } from './versions.schemas';

function toResponse(r: VersionRow): VersionResponse {
  return {
    id: r.id,
    version: r.version,
    description: r.description,
    is_current: r.is_current,
    is_deprecated: r.is_deprecated,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

export async function getCurrentVersion(db: ProductDatabase): Promise<VersionResponse | undefined> {
  const row = await findCurrentVersion(db);
  return row && toResponse(row);
}

export async function createVersion(db: ProductDatabase, input: VersionCreate): Promise<VersionResponse> {
  const row = await insertCurrentVersion(db, input);
  if (row === 'duplicate') throw new ProductError(400, 'VAL_VERSION_ALREADY_EXISTS', 'Version already exists');
  return toResponse(row);
}
