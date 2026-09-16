/**
 * Derives everything machine-readable about the documentation from the MDX
 * itself, so nothing has to be transcribed twice.
 *
 * Emits:
 *   lib/generated/content.json   per-page metadata, headings and plain text
 *   lib/generated/markdown.json  route -> clean markdown (server-only, ~300 KB)
 *
 * Those feed /llms.txt, /llms-full.txt, the raw .md routes and the search index.
 *
 * Run by `predev` and `prebuild` rather than from next.config.mjs, which is
 * evaluated several times per build and once per dev worker.
 *
 * Nothing is written under app/: `pageExtensions` includes `md`, so a generated
 * markdown file there would silently become a route.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(here);
const docsRoot = join(appRoot, 'app/docs');

/**
 * The nav is the source of truth for titles, descriptions and reading order.
 *
 * Imported rather than parsed: Node strips types natively, `lib/nav.ts` has no
 * imports of its own, and a regex over TypeScript would be one more thing to
 * keep in step with a file whose whole purpose is to be the single copy.
 */
async function readNav() {
  const { docsNav } = await import(pathToFileURL(join(appRoot, 'lib/nav.ts')).href);
  return docsNav;
}

/** Turn one MDX file into clean markdown and a searchable text blob. */
function convert(source, title, description) {
  // Code fences are lifted out before anything else touches the text. The
  // sentinel is a private-use codepoint, which cannot appear in real MDX.
  // Stripping MDX `import` statements would otherwise gut every code example
  // that shows an import — which is most of them, and the part an agent most
  // needs. They go back in at the end.
  const fences = [];
  let text = source.replace(/```[\s\S]*?```/g, (block) => {
    fences.push(block);
    return `\uE000FENCE${fences.length - 1}\uE000`;
  });

  // MDX machinery, now that no code example can be mistaken for it.
  text = text.replace(/^import\s[\s\S]*?;\s*$/gm, '');
  text = text.replace(/^export const metadata = buildMetadata\(\{[\s\S]*?\}\);\s*$/gm, '');
  text = text.replace(/^export const metadata = \{[\s\S]*?\};\s*$/gm, '');

  const headings = [];

  // <ApiMethod name="x" signature="y"> -> ### x + a signature fence
  text = text.replace(/<ApiMethod\s+([^>]*?)>/g, (_match, attributes) => {
    const name = /name="([^"]*)"/.exec(attributes)?.[1] ?? '';
    const signature = /signature="([^"]*)"/.exec(attributes)?.[1];
    headings.push({ depth: 3, text: name, id: slug(name) });
    return signature ? `### ${name}\n\n\`\`\`ts\n${signature}\n\`\`\`\n` : `### ${name}\n`;
  });
  text = text.replace(/<\/ApiMethod>/g, '');

  // <Prop name="x" type="y" defaultValue="z"> -> a bullet
  text = text.replace(/<Prop\s+([^>]*?)>/g, (_m, attributes) => {
    const name = /name="([^"]*)"/.exec(attributes)?.[1] ?? '';
    const type = /type="([^"]*)"/.exec(attributes)?.[1] ?? '';
    const fallback = /defaultValue="([^"]*)"/.exec(attributes)?.[1];
    const required = /\brequired\b/.test(attributes) ? ', required' : '';
    return `\n- **${name}** (\`${type}\`${fallback ? `, default \`${fallback}\`` : ''}${required}) — `;
  });
  text = text.replace(/<\/Prop>/g, '');

  text = text.replace(/<Throw\s+code="([^"]*)"[^>]*>/g, '\n- `$1` — ');
  text = text.replace(/<\/Throw>/g, '');
  text = text.replace(/<Returns\s+type="([^"]*)"[^>]*>/g, '\n**Returns** `$1` — ');
  text = text.replace(/<\/Returns>/g, '');

  text = text.replace(/<Callout[^>]*title="([^"]*)"[^>]*>/g, '\n> **$1**\n>\n> ');
  text = text.replace(/<Callout[^>]*>/g, '\n> ');
  text = text.replace(/<\/Callout>/g, '\n');

  text = text.replace(/<Reason[^>]*title="([^"]*)"[^>]*>/g, '\n> **$1**\n>\n> ');
  text = text.replace(/<Reason[^>]*>/g, '\n> **Why it works this way**\n>\n> ');
  text = text.replace(/<\/Reason>/g, '\n');

  text = text.replace(/<Step\s+[^>]*title="([^"]*)"[^>]*>/g, '\n#### $1\n');
  text = text.replace(
    /<ContrastItem\s+[^>]*tone="good"[^>]*title="([^"]*)"[^>]*>/g,
    '\n**Do this — $1:**\n',
  );
  text = text.replace(
    /<ContrastItem\s+[^>]*tone="bad"[^>]*title="([^"]*)"[^>]*>/g,
    '\n**Not this — $1:**\n',
  );
  text = text.replace(/<Card\s+[^>]*href="([^"]*)"[^>]*title="([^"]*)"[^>]*>/g, '\n- [$2]($1) — ');
  text = text.replace(/<TabsTrigger[^>]*>([^<]*)<\/TabsTrigger>/g, '');
  text = text.replace(/<TabsContent\s+[^>]*value="([^"]*)"[^>]*>/g, '\n#### $1\n');

  // <ChecksTable ceremony="x" /> -> the same table the page renders, from the
  // same registry. Stripping it as layout would drop both check tables out of
  // the corpus that /llms.txt and the raw .md routes serve.
  text = text.replace(/<ChecksTable\s+ceremony="(\w+)"\s*\/>/g, (_m, ceremony) => {
    const rows = stats.checkList[ceremony] ?? [];
    const section = ceremony === 'registration' ? '\u00a77.1' : '\u00a77.2';
    return [
      `${rows.length} checks, in WebAuthn ${section} order.`,
      '',
      '| # | Check | Failure code | Specification |',
      '| --- | --- | --- | --- |',
      ...rows.map((r) => `| ${r.index} | ${r.title} | \`${r.code}\` | ${r.spec} |`),
      '',
    ].join('\n');
  });

  // Any remaining JSX tags are layout.
  text = text.replace(/<\/?[A-Z][A-Za-z]*(\s[^>]*)?\/?>/g, '');

  for (const match of text.matchAll(/^(#{2,4})\s+(.+)$/gm)) {
    headings.push({ depth: match[1].length, text: match[2].trim(), id: slug(match[2]) });
  }

  // Put the code back.
  text = text.replace(/\uE000FENCE(\d+)\uE000/g, (_m, index) => fences[Number(index)]);

  const body = text.replace(/\n{3,}/g, '\n\n').trim();
  const markdown = `# ${title}\n\n${description}\n\n${body}\n`;

  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { markdown, plain, headings };
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

function gitDate(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
      encoding: 'utf8',
      cwd: appRoot,
    }).trim();
  } catch {
    return '';
  }
}

const stats = await readStats();
const nav = await readNav();
const pages = [];
const markdown = {};

for (const section of nav) {
  for (const item of section.items) {
    const relativePath =
      item.href === '/docs' ? 'page.mdx' : `${item.href.slice('/docs/'.length)}/page.mdx`;
    const file = join(docsRoot, relativePath);
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      console.warn(`build-content: no MDX for ${item.href}`);
      continue;
    }

    const { markdown: body, plain, headings } = convert(source, item.title, item.description);
    markdown[item.href] = body;
    pages.push({
      route: item.href,
      title: item.title,
      description: item.description,
      section: section.title,
      headings,
      text: plain,
      words: plain.split(/\s+/).length,
      lastModified: gitDate(relative(appRoot, file)),
    });
  }
}

const outDir = join(appRoot, 'lib/generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'content.json'), `${JSON.stringify({ nav, pages }, null, 2)}\n`);
writeFileSync(join(outDir, 'markdown.json'), `${JSON.stringify(markdown, null, 2)}\n`);

const totalWords = pages.reduce((sum, page) => sum + page.words, 0);
console.log(
  `build-content: ${pages.length} pages, ${totalWords.toLocaleString()} words, ` +
    `${(JSON.stringify(markdown).length / 1024).toFixed(0)} KB of markdown`,
);

// ------------------------------------------------------------------- stats
/**
 * The figures the landing page puts in front of the reader.
 *
 * Derived here rather than typed into the page, because the section they sit
 * in is headed "numbers you can verify yourself" — a claim that only survives
 * if nobody can quietly out-edit it. Every one of these reads from the library
 * that is about to be published: its manifest, its generated check and error
 * registries, and its real bundled bytes.
 */
async function readStats() {
  const libRoot = join(appRoot, '../../packages/passkify');
  const read = (file) => JSON.parse(readFileSync(join(libRoot, file), 'utf8'));

  const manifest = read('package.json');
  const checks = read('generated/checks.json');
  const errors = read('generated/errors.json');
  const api = read('generated/api.json');

  // The client half as a bundler would actually deliver it. Measured from
  // src, so the number cannot lag a build that was never re-run.
  const { build } = await import('esbuild');
  const bundle = await build({
    entryPoints: [join(libRoot, 'src/client/index.ts')],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const minified = bundle.outputFiles[0].contents;
  const { gzipSync } = await import('node:zlib');

  const byCeremony = (ceremony) => checks.filter((check) => check.ceremony === ceremony).length;

  return {
    runtimeDependencies: Object.keys(manifest.dependencies ?? {}).length,
    checks: {
      total: checks.length,
      registration: byCeremony('registration'),
      authentication: byCeremony('authentication'),
    },
    errorCodes: errors.length,
    exports: api.server.length + api.client.length,
    client: {
      minifiedBytes: minified.byteLength,
      gzippedBytes: gzipSync(minified, { level: 9 }).byteLength,
    },
    /**
     * Both ceremonies, each in the order its verifier runs them. The docs
     * tables and the landing page's check list render from this, so a check
     * added to the server appears in every one of them or in none.
     */
    checkList: Object.fromEntries(
      ['registration', 'authentication'].map((ceremony) => [
        ceremony,
        checks
          .filter((check) => check.ceremony === ceremony)
          .map(({ index, id, title, code, spec }) => ({ index, id, title, code, spec })),
      ]),
    ),
  };
}

writeFileSync(join(outDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);

console.log(
  `build-content: ${stats.checks.total} checks, ${stats.errorCodes} error codes, ` +
    `client ${(stats.client.minifiedBytes / 1024).toFixed(1)} KB min / ` +
    `${(stats.client.gzippedBytes / 1024).toFixed(1)} KB gzip`,
);
