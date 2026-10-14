import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Deliberately correctness-only: no stylistic rules (Prettier owns formatting), and the React
// rules that mostly produce false positives on typed code are off. `no-empty` (recommended) keeps
// empty `catch` blocks out, as the engineering rules require.
export default defineConfig(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.swarm/**',
      '.claude*/**',
      'docs/**'
    ]
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [react.configs.flat.recommended, react.configs.flat['jsx-runtime']],
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      // TypeScript types replace prop-types; the other two flag valid, well-typed JSX.
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['src/renderer/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    extends: [reactRefresh.configs.vite()],
    rules: {
      // Only affects Fast Refresh (HMR), not correctness.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  }
)
