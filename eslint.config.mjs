import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import local from './eslint/no-comments.js';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', '.tailnet/**', 'out/**', 'build/**', 'next-env.d.ts']),
  {
    plugins: { local },
    rules: {
      'local/no-comments': 'error',
    },
  },
]);

export default eslintConfig;
