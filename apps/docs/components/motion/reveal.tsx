'use client';

import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/** Past this much of the section being on screen, revealing it is too late. */
const ALREADY_ARRIVED = 0.55;

/**
 * Entry reveal for a section's contents.
 *
 * The motion does one job: sequencing. A section here is an argument with an
 * order to it (label, then claim, then evidence), and staggering the entry
 * makes the reader take it in that order instead of all at once. It is not
 * decoration, which is why it runs once and never loops.
 *
 * It fires at `top bottom`, the instant the section's top edge touches the
 * viewport, so in ordinary scrolling the reveal finishes before the reader
 * arrives rather than starting when they do.
 *
 * Two guards, because `gsap.from` hides the content up front and then depends
 * on an event to give it back. That is a bad trade if the event is ever
 * missed, and a section stuck at zero opacity reads as a page that failed to
 * load:
 *
 *  - `onEnter` checks whether the section has already arrived. A fast flick, a
 *    restored scroll position or an anchor jump can land the reader inside a
 *    section before its trigger has fired, and animating then hides content
 *    they are already looking at. In that case the tween goes straight to its
 *    end.
 *  - An IntersectionObserver is the safety net. It reports actual visibility
 *    rather than a scroll accounting, so it still fires when ScrollTrigger's
 *    view of the scroll position is stale (a programmatic jump, a throttled
 *    tab, a browser restoring position on reload). If the section is on screen
 *    and the reveal has not started, the content is shown. Being briefly
 *    un-animated is a far smaller failure than never appearing.
 *
 * `gsap.matchMedia` carries the reduced-motion contract: under
 * `prefers-reduced-motion` the context never runs. Nothing is hidden in CSS to
 * begin with, so a reader who never gets the animation still gets the content.
 */
export function Reveal({
  children,
  className,
  stagger = 0.05,
  y = 18,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  y?: number;
}) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const root = scope.current;
        if (!root) return;

        const arrived = () =>
          root.getBoundingClientRect().top < window.innerHeight * ALREADY_ARRIVED;

        // Mounted with the section already on screen: never hide it at all.
        if (arrived()) return;

        const tween = gsap.from(gsap.utils.toArray<HTMLElement>('[data-reveal]'), {
          opacity: 0,
          y,
          duration: 0.45,
          ease: 'power2.out',
          stagger,
          scrollTrigger: {
            trigger: root,
            start: 'top bottom',
            once: true,
            onEnter: (self) => {
              if (arrived()) self.animation?.progress(1);
            },
          },
        });

        const net = new IntersectionObserver(
          (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            if (tween.progress() === 0) tween.progress(1);
            net.disconnect();
          },
          { rootMargin: '0px 0px -20% 0px' },
        );
        net.observe(root);

        return () => net.disconnect();
      });
      return () => mm.revert();
    },
    { scope },
  );

  return (
    <div ref={scope} className={cn(className)}>
      {children}
    </div>
  );
}
