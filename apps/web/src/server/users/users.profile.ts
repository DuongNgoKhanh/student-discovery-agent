import 'server-only';
import type { components } from '@/generated/api/user-api';
import type { UserRow } from './users.types';

export type UserProfile = components['schemas']['UserProfile'];

/** Public profile per contract `UserProfile`; never exposes `hashed_password` / `is_deleted`. */
export function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url,
    bio: row.bio,
    position: row.position,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at ? row.updated_at.toISOString() : null,
  };
}
