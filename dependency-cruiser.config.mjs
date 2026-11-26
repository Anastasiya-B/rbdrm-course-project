export default {
  forbidden: [
    {
      name: 'no-circular-runtime-dependencies',
      severity: 'error',

      comment:
        'Runtime modules must remain acyclic; TypeORM entity relations are excluded because bidirectional relations intentionally reference each other.',

      from: {
        pathNot: '^src/entities/',
      },

      to: {
        circular: true,
      },
    },

    {
      name: 'hw32-module-boundary',
      severity: 'error',

      comment:
        'Module A must not import Module B directly in the architecture fixture.',

      from: {
        path: '^fixtures/hw32/architecture/broken/module-a\\.ts$',
      },

      to: {
        path: '^fixtures/hw32/architecture/broken/module-b\\.ts$',
      },
    },
  ],

  options: {
    /*
     * src/dist is generated output checked into the historical
     * repository. Architecture rules must operate on source,
     * never on generated JavaScript.
     */
    exclude: '^src/dist/',

    doNotFollow: {
      path: 'node_modules',
    },

    tsPreCompilationDeps: true,

    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.mjs', '.json'],
    },
  },
};
