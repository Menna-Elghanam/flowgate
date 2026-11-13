import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      'apps/api/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        // Nest reads constructor parameter types at runtime, so DI classes must stay value imports.
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
