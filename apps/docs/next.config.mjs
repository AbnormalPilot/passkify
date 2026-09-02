import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import createMDX from '@next/mdx';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypePrettyCode from 'rehype-pretty-code';

/**
 * The code theme, set on the system's `canvas-soft` ground.
 *
 * Code blocks are the one dark object on a light documentation page, framed as
 * application chrome rather than as a marketing card. Syntax colour is what
 * makes that frame worth having: a reader scanning for the call in an example
 * finds it by hue long before they finish reading the line.
 *
 * The palette deliberately does NOT spend `{colors.brand}` (#f36458). Keywords
 * appear dozens of times per block, and painting them coral would put the
 * page's signature accent everywhere and cost it the scarcity it works by.
 * Peach sits in the same warm family and reads as related without competing
 * with the one coral CTA in the viewport.
 *
 * Strings and calls reuse the system's own semantic colours, `{colors.success}`
 * and `{colors.link-blue-soft}`, so the block stays inside the palette rather
 * than importing a stock highlighter's.
 *
 * Every foreground was measured against the code ground (#212121). The
 * lowest-contrast of them, used for comments, is 5.72:1, which clears AA.
 */
const codeTheme = {
  name: 'saniti-dark',
  type: 'dark',
  colors: {
    'editor.background': '#212121',
    'editor.foreground': '#e6e6e6',
  },
  tokenColors: [
    // 5.72:1
    { scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#9a9a9a', fontStyle: 'italic' } },
    // 7.84:1
    { scope: ['string', 'string.quoted', 'constant.other.symbol', 'string.template'],
      settings: { foreground: '#37cd84' } },
    // 9.25:1
    { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier',
              'keyword.control', 'keyword.operator.new', 'keyword.operator.expression'],
      settings: { foreground: '#ffb38a' } },
    // 7.82:1
    { scope: ['entity.name.function', 'support.function', 'meta.function-call',
              'variable.function'],
      settings: { foreground: '#55beff' } },
    // 9.59:1
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class',
              'entity.other.inherited-class'],
      settings: { foreground: '#f2c14e' } },
    // 10.54:1
    { scope: ['constant.numeric', 'constant.language', 'constant.character',
              'support.constant'],
      settings: { foreground: '#9ad9ff' } },
    // 12.90:1
    { scope: ['variable', 'variable.other', 'meta.object-literal.key',
              'support.variable', 'variable.parameter'],
      settings: { foreground: '#e6e6e6' } },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: '#9a9a9a' } },
    { scope: ['entity.name.tag'], settings: { foreground: '#ffb38a' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#f2c14e' } },
  ],
};

/**
 * Highlighting runs at build time, so no highlighter ships to the browser.
 *
 * `defaultLang` names a block language only. Setting an inline default made
 * rehype-pretty-code highlight every `code` span in running prose as well, and
 * those sit on the LIGHT documentation ground: the dark theme's foregrounds
 * were being painted onto a near-white chip, which is why inline references
 * rendered as pale grey on pale grey. Inline code is now left unhighlighted
 * and coloured by the stylesheet, where it can see which surface it is on.
 */
const prettyCodeOptions = {
  theme: codeTheme,
  keepBackground: false,
  defaultLang: { block: 'ts' },
};

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      rehypeSlug,
      // Headings become their own anchors, so every section is linkable.
      [rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: ['heading-anchor'] } }],
      [rehypePrettyCode, prettyCodeOptions],
    ],
  },
});

/**
 * The site consumes the library's TypeScript source, not its build output.
 *
 * npm workspaces already symlinks `node_modules/passkify` to the sibling
 * package, so `import 'passkify'` resolves without this. But that path goes
 * through the package's `exports`, which point at `dist/` — so every start
 * would need a build first, and a stale build would silently be what the docs
 * demonstrate. Aliasing to `src/` instead means `npm run dev` is the whole
 * command, and editing the library hot-reloads the site like any other file.
 *
 * The published `dist/` build is still exercised: `npm test -w passkify` builds
 * it, and CI runs that on every push.
 *
 * Two aliases are needed. One maps the package name to its entry points; the
 * other teaches webpack that the `.js` specifiers in the source (required by
 * TypeScript's NodeNext resolution, and correct for the published build) point
 * at `.ts` files here.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const librarySource = join(repoRoot, 'packages/passkify/src/');

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  // This app reads source from a sibling workspace package, so tracing has to
  // start at the repo root — both to find those files and to pick the single
  // lockfile there rather than guessing at a workspace root.
  outputFileTracingRoot: repoRoot,

  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Longest specifier first: webpack matches these in order.
      'passkify/client': join(librarySource, 'client/index.ts'),
      'passkify/server': join(librarySource, 'server/index.ts'),
      passkify: join(librarySource, 'index.ts'),
    };
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default withMDX(nextConfig);
