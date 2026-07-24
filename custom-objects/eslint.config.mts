import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

import globals from 'globals';

import stripeAppsConfig from '@stripe/extensibility-eslint-plugin';
import customObjectsConfig from '@stripe/extensibility-eslint-plugin/custom-objects';

export default defineConfig([
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...stripeAppsConfig,
  ...customObjectsConfig,

  // Global ignores
  {
    ignores: ['dist', 'generated', 'node_modules'],
  },

  // TypeScript source files (with type-checking)
  {
    name: 'sources',
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__tests__/**'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Test files (type-checking, relaxed rules)
  {
    name: 'tests',
    files: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
    },
  },

  // Config files
  {
    name: 'ts-configs',
    files: ['*.config.m?ts', 'eslint.config.mts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // JavaScript/MJS files (scripts, configs)
  {
    name: 'js-configs',
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },

  eslintConfigPrettier,
]);
