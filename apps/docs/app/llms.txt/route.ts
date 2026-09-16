import { pagesBySection } from '@/lib/content';
import { absoluteUrl, LIBRARY_VERSION } from '@/lib/site';

/**
 * `/llms.txt` — the map an agent reads first.
 *
 * Every link points at the `.md` twin rather than the HTML page, because an
 * agent fetching the HTML gets a JavaScript shell whose navigation and table of
 * contents are client-rendered.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  const sections = pagesBySection()
    .map(({ section, pages }) => {
      const links = pages
        .map((page) => `- [${page.title}](${absoluteUrl(page.route)}.md): ${page.description}`)
        .join('\n');
      return `## ${section}\n\n${links}`;
    })
    .join('\n\n');

  const body = `# passkify

> Passkeys (WebAuthn) for a website: client and server in one npm package, zero
> runtime dependencies, and every check the WebAuthn specification asks for.
> Runs on Node 20+, Bun, Deno, Cloudflare Workers and Vercel Edge.
> Version ${LIBRARY_VERSION}. MIT licensed.

Install with \`npm install passkify\`. Import \`passkify/server\` on the server and
\`passkify/client\` in the browser — the package root is server code and will fail
to build in a browser bundle.

${sections}

## For coding agents

- [Everything, as one file](${absoluteUrl('/llms-full.txt')}): the complete documentation
- Skills for your agent: \`npx passkify skills install\` — installs five skills covering the server, the browser, storage and debugging
- MCP server: \`npx passkify mcp\` — search the docs, explain an error code, or validate a configuration against the real validator
- Check an integration: \`npx passkify doctor\`

## Optional

- [Source](https://github.com/AbnormalPilot/passkify)
- [npm](https://www.npmjs.com/package/passkify)
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
