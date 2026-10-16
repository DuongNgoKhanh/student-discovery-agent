'use client';

import { useMutation } from '@tanstack/react-query';
import { login } from '../api/auth';
import type { LoginInput } from '../schemas/auth';

export function useLogin() {
  return useMutation({ mutationFn: (input: LoginInput) => login(input) });
}
