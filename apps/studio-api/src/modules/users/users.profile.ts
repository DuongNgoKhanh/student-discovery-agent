import type { components } from '@/generated/api/user-api';
import type { components as AdminComponents } from '@/generated/api/admin-api';
import type { UserRow } from '@/modules/users/users.types';

export type UserProfile = components['schemas']['UserProfile'];
export type PublicUserProfile = Pick<UserProfile, 'id' | 'name' | 'avatar_url' | 'position'>;
export type AdminUserProfile = AdminComponents['schemas']['AdminUserResponse'];

/** Self profile; includes private fields of the authenticated user. */
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

/** Admin projection: public profile plus `is_deleted`; still never the hash. */
export function toAdminProfile(row: UserRow): AdminUserProfile {
  return { ...toUserProfile(row), created_at: row.created_at.toISOString(), is_deleted: row.is_deleted };
}

/** Public directory projection excludes private account details. */
export function adminToPublic(p: AdminUserProfile): PublicUserProfile {
  return { id: p.id, name: p.name, avatar_url: p.avatar_url, position: p.position };
}

/** Self projection from an admin result; private fields belong to the current user. */
export function adminToSelf(p: AdminUserProfile): UserProfile {
  return { id: p.id, email: p.email, name: p.name, avatar_url: p.avatar_url, bio: p.bio, position: p.position, created_at: p.created_at, updated_at: p.updated_at };
}
