/**
 * Builds the package: ESM, CommonJS, and the declaration files each half needs.
 *
 * This is one script rather than five chained npm scripts because npm prints a
 * banner per script, and `npm run build` was emitting five blocks of noise for
 * what is really one step.
 *
 * Two things here are not obvious:
 *
 * The `package.json` markers matter. The root manifest says `"type": "module"`,
 * so without a `package.json` in `dist/cjs` claiming `"commonjs"`, Node would
 * load the CommonJS build as ESM and fail on the first `require`.
 *
 * The `.d.cts` rename matters more. TypeScript emits `.d.ts` for both builds,
 * and a `.d.ts` sitting beside a `{"type":"module"}` marker describes an ES
 * module — so a CommonJS consumer resolving types under `node16` was being
 * handed ESM declarations for a `require()`. `attw` calls this "masquerading as
 * ESM", and it is why `pkg.exports` now names a separate `types` per condition.
 * Renaming to `.d.cts` is only half the fix: the specifiers *inside* those
 * files have to point at `.cjs` too, or each one resolves back to the ESM
 * declaration next door.
 */
import {
  copyFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  readFileSync,
  cpSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

rmSync('dist', { recursive: true, force: true });

for (const project of ['tsconfig.esm.json', 'tsconfig.cjs.json']) {
  execFileSync('npx', ['tsc', '-p', project], { stdio: 'inherit' });
}

/** Every file under `dir`, recursively. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

// Rewrite relative specifiers from `./x.js` to `./x.cjs` so each declaration
// resolves to its CommonJS sibling rather than the ESM one, then rename.
const RELATIVE_JS = /(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\.js\2/g;
let renamed = 0;

for (const file of walk('dist/cjs')) {
  if (!file.endsWith('.d.ts')) continue;
  const source = readFileSync(file, 'utf8').replace(RELATIVE_JS, '$1$2$3.cjs$2');
  const target = `${file.slice(0, -'.d.ts'.length)}.d.cts`;
  writeFileSync(file, source);
  renameSync(file, target);
  renamed += 1;
}

for (const [dir, type] of [
  ['dist/esm', 'module'],
  ['dist/cjs', 'commonjs'],
]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/package.json`, `${JSON.stringify({ type }, null, 2)}\n`);
}

// The skills ship inside the package so `npx passkify skills install` works
// offline, with no network fetch. Copied rather than symlinked: npm pack and
// Windows both handle symlinks badly.
const skillsSource = join('..', '..', 'skills');
if (existsSync(skillsSource)) {
  cpSync(skillsSource, 'dist/esm/cli/skills', { recursive: true });
}

// The changelog lives at the repository root, where it documents this package
// and nothing else — and where the release workflow reads the entry it turns
// into release notes. `files` lists it, so copy it in at build time rather than
// keeping a second copy that would drift from the one CI reads.
const changelogSource = join('..', '..', 'CHANGELOG.md');
if (existsSync(changelogSource)) {
  copyFileSync(changelogSource, 'CHANGELOG.md');
}

execFileSync('node', ['scripts/generate.mjs'], { stdio: 'inherit' });

console.log(`build: ${renamed} CommonJS declaration files written as .d.cts`);
