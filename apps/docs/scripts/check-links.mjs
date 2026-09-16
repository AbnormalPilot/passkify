/**
 * Verifies documentation integrity, which `next build` does not:
 *
 *  - every route in lib/nav.ts has a page.mdx
 *  - every page.mdx appears in lib/nav.ts, so nothing is unreachable
 *  - every internal /docs link resolves to a page
 *  - every #anchor resolves to a heading or an <ApiMethod name>
 *
 * A broken markdown link is perfectly valid MDX, so it compiles and then 404s
 * for a reader. This is the only thing that catches it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DOCS = 'app/docs';

/** Mirrors the slugify in components/docs-components.tsx. */
const apiSlug = (value) =>
  value
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s.]+/g, '-')
    .toLowerCase();

/** Mirrors rehype-slug's behaviour for markdown headings. */
const headingSlug = (value) =>
  value
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();

const pages = new Map();

(function walk(dir, route) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, `${route}/${entry.name}`);
    } else if (entry.name === 'page.mdx') {
      const source = readFileSync(full, 'utf8');
      const anchors = new Set();
      for (const match of source.matchAll(/^#{1,4}\s+(.+)$/gm)) {
        anchors.add(headingSlug(match[1]));
      }
      for (const match of source.matchAll(/<ApiMethod[\s\S]*?name="([^"]+)"/g)) {
        anchors.add(apiSlug(match[1]));
      }
      pages.set(route || '/docs', { source, anchors });
    }
  }
})(DOCS, '/docs');

const nav = readFileSync('lib/nav.ts', 'utf8');
const declared = [...nav.matchAll(/href: '(\/docs[^']*)'/g)].map((m) => m[1]);

const problems = [];

for (const route of declared) {
  if (!pages.has(route)) problems.push(`nav declares ${route} but there is no page.mdx`);
}
for (const route of pages.keys()) {
  if (!declared.includes(route)) problems.push(`${route} exists but is not in lib/nav.ts`);
}

let linkCount = 0;
for (const [route, { source }] of pages) {
  for (const match of source.matchAll(/\]\((\/docs[^)]*)\)/g)) {
    linkCount++;
    const [target, anchor] = match[1].split('#');
    if (!pages.has(target)) {
      problems.push(`${route} links to ${match[1]}, which is not a page`);
    } else if (anchor && !pages.get(target).anchors.has(anchor)) {
      problems.push(`${route} links to ${match[1]}, but that anchor does not exist`);
    }
  }
}

console.log(`${pages.size} pages, ${linkCount} internal links checked`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('all routes and links resolve');
