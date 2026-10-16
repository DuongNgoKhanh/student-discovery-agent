import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/api/**'] },
  ...tseslint.configs.recommended,
  { rules: { 'no-restricted-imports': ['error', { patterns: ['next', 'next/*', 'react', 'react/*', 'server-only'] }] } },
];
