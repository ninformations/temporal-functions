import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'worker/index': 'src/worker/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    '@temporalio/client',
    '@temporalio/worker',
    '@temporalio/workflow',
    '@temporalio/activity',
  ],
});
