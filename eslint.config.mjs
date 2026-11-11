import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'evidence/**', 'private/**', 'deploy/k8s/rendered/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      // Existing code uses dynamic payloads and these patterns extensively. This
      // gate enforces the remaining recommended rules without rewriting domain code.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      'no-regex-spaces': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['public/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
    },
  },
);
