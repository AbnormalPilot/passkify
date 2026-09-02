'use client';

import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Depth for one element, taken from the page's own scroll.
 *
 * The layer travels `distance` pixels over the whole time it is on screen,
 * from +half at the moment it enters to -half as it leaves, so it is at rest
 * exactly when it is centred — the point at which it is being read. Nothing is
 * pinned and no scroll is intercepted: the reader's wheel still moves the page
 * by the amount they asked for, and the only thing the scroll position decides
 * is how far this element has drifted against its neighbours.
 *
 * `ease: 'none'` is required rather than stylistic. Any other curve makes the
 * drift accelerate independently of the wheel, which is what reads as the
 * page fighting the reader.
 *
 * The transform is applied to an inner layer, not to the trigger. ScrollTrigger
 * measures the trigger's position on every refresh, so a trigger that is also
 * being translated re-bases itself against its own drift and creeps a little
 * further each resize. Keeping the measured box and the moving box separate
 * makes refresh idempotent without a corrective reset.
 *
 * Below 768px there is no room for the effect to be legible and under
 * `prefers-reduced-motion` it must not run at all, so in both cases the layer
 * is simply never transformed. The markup is identical either way.
 */
export function Parallax({
  children,
  className,
  distance = 72,
}: {
  children: React.ReactNode;
  className?: string;
  /** Total travel in px across the full on-screen crossing. */
  distance?: number;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        if (!layer.current || !scope.current) return;

        gsap.fromTo(
          layer.current,
          { y: distance / 2 },
          {
            y: -distance / 2,
            ease: 'none',
            scrollTrigger: {
              trigger: scope.current,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
              invalidateOnRefresh: true,
            },
          },
        );
      });
      return () => mm.revert();
    },
    { scope, dependencies: [distance] },
  );

  return (
    <div ref={scope} className={cn(className)}>
      <div ref={layer}>{children}</div>
    </div>
  );
}
