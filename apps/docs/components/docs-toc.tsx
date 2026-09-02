'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Heading {
  id: string;
  text: string;
  level: number;
}

/**
 * "On this page", derived from the rendered DOM rather than from the MDX
 * source.
 *
 * Reading the DOM means the list is automatically correct for headings that
 * components emit (every `<ApiMethod>` renders one), which a source-parsing
 * remark plugin would miss.
 */
export function DocsToc() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const article = document.querySelector('[data-docs-content]');
    if (!article) return;

    const found = Array.from(article.querySelectorAll<HTMLElement>('h2[id], h3[id]')).map((el) => ({
      id: el.id,
      text: el.textContent?.replace(/#$/, '').trim() ?? '',
      level: Number(el.tagName[1]),
    }));
    setHeadings(found);
    if (found.length === 0) return;

    /* A top-biased root margin makes the highlighted entry the heading you are
       reading, not the one that happens to be nearest the viewport centre. */
    observer.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );

    found.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.current?.observe(el);
    });

    return () => observer.current?.disconnect();
  }, []);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="t-mono-caps mb-sm border-b border-hairline pb-2 text-graphite">
        On this page
      </p>
      <ul className="space-y-1.5 border-l border-border">
        {headings.map((heading) => (
          <li key={heading.id} style={{ paddingLeft: heading.level === 3 ? '1.5rem' : '0.75rem' }}>
            <a
              href={`#${heading.id}`}
              className={cn(
                '-ml-px block border-l-2 py-0.5 pl-3 font-mono text-[12px] leading-snug transition-colors',
                activeId === heading.id
                  ? 'border-brand font-medium text-ink'
                  : 'border-transparent text-graphite hover:text-ink',
              )}
              style={{ marginLeft: heading.level === 3 ? '-1.5rem' : '-0.75rem' }}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
