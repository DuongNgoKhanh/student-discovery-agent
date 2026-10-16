'use client';

import { useMutation } from '@tanstack/react-query';
import { adminLogin } from '../api/auth';
import type { AdminLoginInput } from '../schemas/auth';

export function useAdminLogin() {
  return useMutation({ mutationFn: (input: AdminLoginInput) => adminLogin(input) });
}
