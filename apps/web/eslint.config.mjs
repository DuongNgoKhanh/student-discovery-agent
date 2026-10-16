import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const serverBoundary = {
  patterns: [
    {
      group: ['@/server', '@/server/*', '**/server', '**/server/*'],
      message: 'Client-reachable code (features/components/lib) must not import from src/server; call route handlers instead.',
    },
  ],
};

const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'src/generated/api/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', serverBoundary] },
  },
  {
    // Server-only helper temporarily living in lib/; removed in Task 7.
    files: ['src/lib/api/server.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default eslintConfig;
