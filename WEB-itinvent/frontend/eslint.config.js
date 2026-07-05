import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['src/components/chat/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/pages/chat/*'],
          message: 'components/chat must not import from pages/chat (see ADR-0002).',
        }],
      }],
    },
  },
  {
    files: ['src/pages/chat/**/*.{js,jsx}', 'src/components/chat/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'import/no-unresolved': 'off',
    },
  },
];
