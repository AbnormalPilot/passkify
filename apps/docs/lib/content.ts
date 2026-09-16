/**
 * Typed access to what `scripts/build-content.mjs` generates.
 *
 * The only module allowed to import from `lib/generated`, so that if the shape
 * of those files changes there is exactly one place to fix.
 */

import content from './generated/content.json';
import markdown from './generated/markdown.json';

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

export interface DocPage {
  route: string;
  title: string;
  description: string;
  section: string;
  headings: DocHeading[];
  text: string;
  words: number;
  lastModified: string;
}

const pages = content.pages as DocPage[];
const bodies = markdown as Record<string, string>;

/** Every documentation page, in reading order. */
export function allPages(): DocPage[] {
  return pages;
}

export function allRoutes(): string[] {
  return pages.map((page) => page.route);
}

export function getPage(route: string): DocPage | undefined {
  return pages.find((page) => page.route === route);
}

/** The clean markdown for one page, as served at `<route>.md`. */
export function getMarkdown(route: string): string | undefined {
  return bodies[route];
}

/** Pages grouped by their navigation section, in order. */
export function pagesBySection(): { section: string; pages: DocPage[] }[] {
  const grouped: { section: string; pages: DocPage[] }[] = [];
  for (const page of pages) {
    const last = grouped[grouped.length - 1];
    if (last?.section === page.section) last.pages.push(page);
    else grouped.push({ section: page.section, pages: [page] });
  }
  return grouped;
}
