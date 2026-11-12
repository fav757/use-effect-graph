import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import prettierConfig from 'eslint-config-prettier/flat'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      'codeql-db/**',
      '.migration-reference/**',
      'codeql-graph/provenance/**',
      'codeql-graph/provenance-fixtures/**',
      'codeql-queries/**/.cache/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      '@stylistic': stylistic,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      '@stylistic/padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: '*',
          next: [
            'multiline-block-like',
            'multiline-const',
            'multiline-let',
            'multiline-var',
          ],
        },
        {
          blankLine: 'always',
          prev: [
            'multiline-block-like',
            'multiline-const',
            'multiline-expression',
            'multiline-let',
            'multiline-var',
          ],
          next: '*',
        },
      ],

      curly: ['error', 'multi-line', 'consistent'],
      'id-length': [
        'error',
        {
          min: 2,
          properties: 'never',
          exceptions: ['_', 'i', 't', 'x', 'y'],
        },
      ],

      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      'react-hooks/set-state-in-effect': 'off',
    },
  },

  prettierConfig,
)
