import type { components } from '@/generated/api/user-api';
import type { components as AdminComponents } from '@/generated/api/admin-api';

// DTOs come from the generated contracts (user IDs are integers).
export type User = components['schemas']['UserProfile'];
export type AdminUser = AdminComponents['schemas']['AdminUserResponse'];
