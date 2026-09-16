/**
 * Derives everything that would otherwise be transcribed.
 *
 * The error codes, their HTTP statuses and their documentation live in
 * `src/shared/errors.ts`; the verification checks live in `src/shared/checks.ts`.
 * Every other place that describes them — the skills, the MCP corpus, the docs
 * site — renders from the JSON this writes, so none of them can quietly fall
 * out of step with the code.
 *
 * Run by `npm run build`. CI fails if the output differs from what is committed.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(root));

/** Pull `code` + JSDoc out of the PasskeyErrorCode union, in source order. */
function readErrorCodes() {
  const source = readFileSync(join(root, 'src/shared/errors.ts'), 'utf8');
  const union = source.slice(
    source.indexOf('export type PasskeyErrorCode ='),
    source.indexOf('export class PasskeyError'),
  );

  const codes = [];
  // Each member is an optional JSDoc block followed by `| 'the_code'`.
  const member = /(?:\/\*\*([\s\S]*?)\*\/\s*)?\|\s*'([a-z_]+)'/g;
  for (const match of union.matchAll(member)) {
    const doc = (match[1] ?? '')
      .split('\n')
      .map((line) =>
        line
          .replace(/^\s*\*ual?\s?/, '')
          .replace(/^\s*\*\s?/, '')
          .trim(),
      )
      .filter(Boolean)
      .join(' ')
      .trim();
    codes.push({ code: match[2], description: doc });
  }
  return codes;
}

/** The HTTP status each code maps to, read from the compiled module. */
async function readStatuses(codes) {
  const { PasskeyError } = await import(join(root, 'dist/esm/shared/errors.js'));
  return Object.fromEntries(codes.map(({ code }) => [code, new PasskeyError(code, '').status]));
}

async function readChecks() {
  const { VERIFICATION_CHECKS } = await import(join(root, 'dist/esm/shared/checks.js'));
  return VERIFICATION_CHECKS;
}

/** Every export of a barrel, with its declaration text. */
function readExports(file) {
  const source = readFileSync(join(root, file), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)/g)) {
    names.add(match[1]);
  }
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of block[1].split(',')) {
      const name = entry
        .replace(/\btype\b/, '')
        .split(' as ')
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

const codes = readErrorCodes();
const statuses = await readStatuses(codes);
const checks = await readChecks();

const errors = codes.map((entry) => ({ ...entry, status: statuses[entry.code] }));
const api = {
  server: readExports('src/server/index.ts'),
  client: readExports('src/client/index.ts'),
};

mkdirSync(join(root, 'generated'), { recursive: true });
const write = (name, value) =>
  writeFileSync(join(root, 'generated', name), `${JSON.stringify(value, null, 2)}\n`);

write('errors.json', errors);
write('checks.json', checks);
write('api.json', api);

// ---------------------------------------------------------------- skills
const errorTable = [
  '| Code | HTTP | What it means |',
  '| --- | --- | --- |',
  ...errors.map((e) => `| \`${e.code}\` | ${e.status} | ${e.description || '—'} |`),
].join('\n');

const checksTable = ['registration', 'authentication']
  .map((ceremony) => {
    const rows = checks
      .filter((check) => check.ceremony === ceremony)
      .map((check) => `| ${check.index} | ${check.title} | \`${check.code}\` | ${check.spec} |`);
    return [
      `### ${ceremony === 'registration' ? 'Registration' : 'Authentication'} — ${rows.length} checks`,
      '',
      '| # | Check | Code on failure | Specification |',
      '| --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
  })
  .join('\n\n');

function fillBlocks(file, blocks) {
  let text = readFileSync(file, 'utf8');
  let changed = false;
  for (const [name, body] of Object.entries(blocks)) {
    const pattern = new RegExp(
      `(<!-- generated:${name} -->)([\\s\\S]*?)(<!-- /generated -->)`,
      'g',
    );
    if (!pattern.test(text)) continue;
    text = text.replace(pattern, `$1\n${body}\n$3`);
    changed = true;
  }
  if (changed) writeFileSync(file, text);
  return changed;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.md')) out.push(path);
  }
  return out;
}

let filled = 0;
for (const file of walk(join(repoRoot, 'skills'))) {
  if (fillBlocks(file, { 'errors-table': errorTable, 'checks-table': checksTable })) filled += 1;
}

console.log(
  `generate: ${errors.length} error codes, ${checks.length} checks, ` +
    `${api.server.length + api.client.length} exports, ${filled} skill files filled`,
);
