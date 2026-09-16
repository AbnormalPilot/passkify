import { allRoutes, getMarkdown, getPage } from '@/lib/content';
import { absoluteUrl } from '@/lib/site';

/**
 * `/docs/<page>.md` — the source markdown for any documentation page.
 *
 * Chosen over `Accept: text/markdown` negotiation for three reasons: the URL is
 * visible and quotable, so it can appear in llms.txt and in a "copy as
 * markdown" button; negotiation would need `Vary: Accept` on every page, which
 * fragments the edge cache of an otherwise fully static site; and the App
 * Router cannot branch a `page.mdx` on a request header without middleware.
 *
 * Next resolves static segments before dynamic ones, so `/docs/client` still
 * reaches `app/docs/client/page.mdx`. Only `/docs/client.md`, which matches no
 * static segment, falls through here.
 */
export const dynamic = 'force-static';
// Anything not enumerated 404s, so this catch-all cannot swallow typos that
// should reach the designed not-found page.
export const dynamicParams = false;

/** `/docs` -> ['index.md'];  `/docs/server/adapters` -> ['server', 'adapters.md'] */
function toSlug(route: string): string[] {
  if (route === '/docs') return ['index.md'];
  const parts = route.slice('/docs/'.length).split('/');
  parts[parts.length - 1] = `${parts[parts.length - 1]}.md`;
  return parts;
}

function fromSlug(slug: string[]): string {
  const parts = [...slug];
  const last = parts.pop() ?? '';
  if (!last.endsWith('.md')) return '';
  const name = last.slice(0, -'.md'.length);
  if (name === 'index' && parts.length === 0) return '/docs';
  return `/docs/${[...parts, name].join('/')}`;
}

export function generateStaticParams(): { slug: string[] }[] {
  return allRoutes().map((route) => ({ slug: toSlug(route) }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  const route = fromSlug(slug);
  const body = route ? getMarkdown(route) : undefined;

  if (!body || !route) {
    return new Response('Not found\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const page = getPage(route);
  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
      // Keeps the markdown twin out of search results while leaving it fully
      // fetchable by agents, which ignore noindex.
      'x-robots-tag': 'noindex',
      link: `<${absoluteUrl(route)}>; rel="canonical"`,
      ...(page?.lastModified ? { 'last-modified': new Date(page.lastModified).toUTCString() } : {}),
    },
  });
}
