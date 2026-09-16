import type { MetadataRoute } from 'next';
import { flatNav } from '@/lib/nav';
import { absoluteUrl } from '@/lib/site';

/**
 * Derived from `flatNav`, which is already the canonical list of documentation
 * routes — so a page that exists in the navigation cannot be missing here, and
 * one that does not exist cannot be advertised.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const landing: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/demo'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/search'), lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
  ];

  const docs: MetadataRoute.Sitemap = flatNav.map((item) => ({
    url: absoluteUrl(item.href),
    lastModified: now,
    changeFrequency: 'weekly',
    // The introduction is the entry point; every other page is a peer.
    priority: item.href === '/docs' ? 0.9 : 0.7,
  }));

  return [...landing, ...docs];
}
