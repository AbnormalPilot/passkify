import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Tests import the package the way a user does — `passkify/server`, not a
 * relative path into `src/`. That keeps the suite honest about the public
 * surface, and it lets one environment variable point the same tests at the
 * compiled output instead:
 *
 *   npm test          → runs against src/, no build, works on every Node
 *   npm run test:dist → builds, then runs the identical suite against dist/
 *
 * The old runner (`node --test test/*.ts`) relied on native type stripping,
 * which is only available from Node 22.18 — so it structurally could not test
 * the Node versions the package claims to support.
 */
const target = process.env.PASSKIFY_TEST_TARGET === 'dist' ? 'dist' : 'src';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const aliases =
  target === 'dist'
    ? {
        'passkify/server': resolve('./dist/esm/server/index.js'),
        'passkify/client': resolve('./dist/esm/client/index.js'),
        passkify: resolve('./dist/esm/index.js'),
        '#internal': resolve('./dist/esm'),
      }
    : {
        'passkify/server': resolve('./src/server/index.ts'),
        'passkify/client': resolve('./src/client/index.ts'),
        passkify: resolve('./src/index.ts'),
        '#internal': resolve('./src'),
      };

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The dist smoke test is meaningless without a build, so it only runs in
    // dist mode — where the whole suite runs against the compiled output too.
    exclude:
      target === 'dist' ? ['node_modules/**'] : ['test/dist-smoke.test.ts', 'node_modules/**'],
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
