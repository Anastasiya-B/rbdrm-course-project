import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'src/dist/**',
      'node_modules/**',
      '.pulumi/**',
      'pacts/**',
      'backups/**',
    ],
  },

  ...tseslint.configs.recommended,

  {
    files: [
      'src/**/*.ts',
      'test/**/*.ts',
      'scripts/hw32/**/*.ts',
      'fixtures/hw32/**/*.ts',
    ],

    rules: {
      '@typescript-eslint/no-explicit-any': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  /*
   * Legacy course demo entrypoints are standalone executable
   * examples accumulated across previous homework.
   *
   * They are still type-checked, but unused demo-only helpers
   * must not block the production CI lint gate.
   */
  {
    files: ['src/demo-*.ts'],

    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
