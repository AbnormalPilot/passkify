/**
 * Builds the package: ESM, CommonJS, and the two markers Node needs to tell
 * them apart.
 *
 * This is one script rather than five chained npm scripts because npm prints a
 * banner per script, and `npm run build` was emitting five blocks of noise for
 * what is really one step.
 *
 * The markers matter: the root package.json says "type": "module", so without
 * a package.json in dist/cjs claiming "commonjs", Node would load the
 * CommonJS build as ESM and fail on the first `require`.
 */
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

rmSync('dist', { recursive: true, force: true });

for (const project of ['tsconfig.esm.json', 'tsconfig.cjs.json']) {
  execFileSync('npx', ['tsc', '-p', project], { stdio: 'inherit' });
}

for (const [dir, type] of [['dist/esm', 'module'], ['dist/cjs', 'commonjs']]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/package.json`, JSON.stringify({ type }, null, 2) + '\n');
}
