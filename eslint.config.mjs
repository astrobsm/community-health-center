// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

/**
 * Lint rules that encode this codebase's architectural invariants.
 * See docs/architecture/05-module-dependency-map.md and 18-security.md.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**', '**/*.generated.ts'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Invariant: no string-built SQL anywhere. Parameterised queries only.
  // (18-security.md §4)
  // ---------------------------------------------------------------------------
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TaggedTemplateExpression[tag.property.name='queryRawUnsafe'], CallExpression[callee.property.name='$queryRawUnsafe'], CallExpression[callee.property.name='$executeRawUnsafe']",
          message:
            'Unsafe raw SQL is forbidden. Use $queryRaw with a tagged template (parameterised) or a named query in sql/.',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Invariant: Prisma is imported only inside repository files.
  // (02-system-architecture.md §2)
  // ---------------------------------------------------------------------------
  {
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['apps/api/src/modules/**/*.repository.ts', 'apps/api/src/modules/**/repositories/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message:
                'Import Prisma only inside a *.repository.ts file. Controllers and services must go through a repository.',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Invariant: packages/contracts stays framework-free so the same schemas run
  // in the browser offline and on the server. (ADR 0001)
  // ---------------------------------------------------------------------------
  {
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'contracts must not depend on NestJS.' },
            { group: ['@prisma/*'], message: 'contracts must not depend on Prisma.' },
            { group: ['react', 'react-*'], message: 'contracts must not depend on React.' },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Invariant: pure domain logic performs no I/O, so it stays exhaustively
  // unit-testable. (02-system-architecture.md §2, 20-testing.md §3)
  // ---------------------------------------------------------------------------
  {
    files: ['apps/api/src/modules/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'domain/ must be pure: no framework imports.' },
            { group: ['@prisma/*'], message: 'domain/ must be pure: no database imports.' },
            { group: ['ioredis', 'bullmq', 'axios', 'node:fs', 'fs'], message: 'domain/ must be pure: no I/O.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Inject a clock instead of reading the ambient time — domain logic must be deterministic.' },
      ],
    },
  },

  // Tests may bend several of these rules.
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
);
