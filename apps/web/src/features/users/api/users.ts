import { api } from '@/lib/api/client';
import type { User } from '../types';

export const usersApi = {
  me: () => api.get<User>('me'),
};
