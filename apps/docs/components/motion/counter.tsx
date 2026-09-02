'use client';

import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * A measured number that counts up once, when it comes into view.
 *
 * These four figures are the page's evidence, and counting draws the eye to
 * the digits rather than the label beside them. It runs once: a number that
 * re-animates every time it scrolls past reads as an ornament, and an
 * ornament is not evidence.
 *
 * The element is server-rendered with its final value, so the figure is
 * correct with JavaScript disabled, under reduced motion, and for a crawler.
 */
export function Counter({
  value,
  decimals = 0,
  className,
}: {
  value: number;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const box = { n: 0 };
        gsap.to(box, {
          n: value,
          duration: 1.1,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = box.n.toFixed(decimals);
          },
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        });
      });
      return () => mm.revert();
    },
    { dependencies: [value, decimals] },
  );

  return (
    <span ref={ref} className={className}>
      {value.toFixed(decimals)}
    </span>
  );
}
