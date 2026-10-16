import next from 'eslint-config-next';

export default [
  ...next(),
  {
    ignores: ['.next/**', 'node_modules/**', 'src/types/api/**', 'coverage/**'],
  },
];
