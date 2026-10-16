'use client';

import { useMutation } from '@tanstack/react-query';
import { register } from '../api/auth';
import type { RegisterInput } from '../schemas/auth';

export function useRegister() {
  return useMutation({ mutationFn: (input: RegisterInput) => register(input) });
}
