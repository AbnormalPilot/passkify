import { allPages } from '@/lib/content';
import { getMarkdown } from '@/lib/content';
import { absoluteUrl, LIBRARY_VERSION } from '@/lib/site';

/**
 * `/llms-full.txt` — the whole documentation as one file.
 *
 * Worth prioritising over `/llms.txt`: agents fetch this roughly twice as
 * often, because one request beats twenty-three.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  const header = `# passkify ${LIBRARY_VERSION} — complete documentation

Passkeys (WebAuthn) for a website. Client and server in one npm package, zero
runtime dependencies. Node 20+, Bun, Deno, Cloudflare Workers, Vercel Edge.

Source: https://github.com/AbnormalPilot/passkify
Documentation: ${absoluteUrl('/')}
Generated from the site's own source, so it cannot drift from what is published.
`;

  const body = allPages()
    .map((page) => {
      const markdown = getMarkdown(page.route) ?? '';
      return `\n\n---\n\n<!-- source: ${absoluteUrl(page.route)} -->\n\n${markdown}`;
    })
    .join('');

  return new Response(`${header}${body}`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
