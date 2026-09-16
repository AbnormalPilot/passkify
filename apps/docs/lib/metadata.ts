import type { Metadata } from 'next';
import { absoluteUrl } from '@/lib/site';

/**
 * Per-page metadata, built from one place.
 *
 * The reason this exists rather than each page hand-writing its own: a
 * canonical URL is only useful if it is *this* page's URL. A single canonical
 * inherited from the root layout tells search engines that all twenty-three
 * documentation pages are duplicates of the landing page, which is strictly
 * worse than having no canonical at all.
 */
export function buildMetadata(input: {
  route: string;
  title: string;
  description: string;
  /** Landing pages get the site name verbatim; documentation pages get the template. */
  absoluteTitle?: boolean;
}): Metadata {
  const url = absoluteUrl(input.route);
  const ogTitle = input.absoluteTitle ? input.title : `${input.title} | passkify`;

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.route },
    openGraph: {
      type: 'article',
      siteName: 'passkify',
      title: ogTitle,
      description: input.description,
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: input.description,
    },
  };
}
