/**
 * JSON-LD.
 *
 * Google says structured data is not required for AI Overviews, and that is
 * true — but it is still the cheapest machine-readable statement of what this
 * project is, and the breadcrumb data already exists for the visible trail, so
 * emitting it costs nothing.
 */

import { absoluteUrl, LIBRARY_VERSION, REPO_URL, NPM_URL } from './site';
import type { DocPage } from './content';

export function softwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'passkify',
    description:
      'Passkeys (WebAuthn) for your website. Client and server in one npm package, zero runtime dependencies, every check the WebAuthn specification asks for.',
    url: absoluteUrl('/'),
    codeRepository: REPO_URL,
    programmingLanguage: 'TypeScript',
    runtimePlatform: ['Node.js', 'Bun', 'Deno', 'Cloudflare Workers'],
    license: 'https://opensource.org/licenses/MIT',
    version: LIBRARY_VERSION,
    author: { '@type': 'Person', name: 'Himanshu Dubey', url: 'https://github.com/AbnormalPilot' },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    downloadUrl: NPM_URL,
    applicationCategory: 'DeveloperApplication',
    keywords: 'passkeys, WebAuthn, FIDO2, passwordless, authentication, TypeScript',
  };
}

export function webSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'passkify',
    url: absoluteUrl('/'),
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${absoluteUrl('/search')}?q={query}` },
      'query-input': 'required name=query',
    },
  };
}

export function techArticleSchema(page: DocPage) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: page.title,
    description: page.description,
    url: absoluteUrl(page.route),
    ...(page.lastModified ? { dateModified: page.lastModified } : {}),
    author: { '@type': 'Person', name: 'Himanshu Dubey' },
    publisher: { '@type': 'Organization', name: 'passkify', url: absoluteUrl('/') },
    isPartOf: { '@type': 'TechArticle', name: 'passkify documentation', url: absoluteUrl('/docs') },
    // The markdown twin, said out loud rather than left to be discovered.
    encoding: {
      '@type': 'MediaObject',
      encodingFormat: 'text/markdown',
      contentUrl: `${absoluteUrl(page.route)}.md`,
    },
  };
}

export function breadcrumbSchema(page: DocPage) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Docs', item: absoluteUrl('/docs') },
      { '@type': 'ListItem', position: 2, name: page.section },
      { '@type': 'ListItem', position: 3, name: page.title, item: absoluteUrl(page.route) },
    ],
  };
}
