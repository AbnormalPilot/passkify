'use client';

import { useEffect, useRef, useState } from 'react';
import { CodeWindow } from '@/components/code-window';
import { Parallax } from '@/components/motion/parallax';
import { cn } from '@/lib/utils';

/* A thin band across the viewport, a little above centre, standing in for the
   line the reader's eye is on. Kept narrow deliberately: a tall band would be
   straddled by two steps at once in the gap between them, and the rail would
   pick whichever reported last. */
const READING_LINE = '-45% 0px -54% 0px';

export interface CeremonyStep {
  label: string;
  title: string;
  body: string;
  file: string;
  code: string;
}

/**
 * The centre of the page: one login, told in order, at the reader's pace.
 *
 * The steps are a sequence in time, and the layout says so without taking the
 * scroll away to prove it. The heading and the rail hold their position while
 * the four steps pass them, which is what a pin was being used for, except
 * that here the wheel still moves the page by the distance the reader asked
 * for. Nothing is captured, so nothing has to be given back.
 *
 * Depth does the rest. Each step's prose and its code window drift at
 * different rates as they cross the viewport, so the pair separates on the way
 * past and settles as it reaches the middle. The code moves further than the
 * text: it is the nearer object, and the difference is what the eye reads as
 * distance between them rather than as two things moving.
 *
 * The rail is driven by which step actually occupies the reading line, not by
 * a fraction of a scrubbed timeline. One trigger per step reports its own
 * arrival, so the label can never disagree with the step beside it, and
 * scrolling back up relights the previous step for the same reason.
 *
 * Everything is server-rendered and in normal document flow. Below 768px, and
 * under `prefers-reduced-motion`, no transform is applied and the section is a
 * plain vertical list of four steps.
 */
export function CeremonyScroller({
  eyebrow,
  heading,
  steps,
}: {
  eyebrow: string;
  heading: string;
  steps: CeremonyStep[];
}) {
  const scope = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  /* Observed rather than scrubbed. This is a readout of which step is on
     screen, not an animation, so it is deliberately not tied to a scroll
     timeline: a reader on `prefers-reduced-motion` still gets a rail that
     tracks them, and the label cannot drift out of step with the panel beside
     it the way a second derivation from scroll progress can.

     No step intersects the line while the reader is in the gap between two,
     so the last step to claim it stays lit rather than the rail blanking. */
  useEffect(() => {
    const root = scope.current;
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-step]'));
    if (items.length < 2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(items.indexOf(entry.target as HTMLElement));
        }
      },
      { rootMargin: READING_LINE },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scope} className="container-editorial md:grid md:grid-cols-[0.72fr_1.28fr] md:gap-xxl">
      {/* Held in place by `sticky`, not by a pin: the column stops at the top
          of the viewport for as long as the steps beside it are running, and
          the page underneath keeps scrolling normally. `self-start` is what
          stops the grid stretching the cell to the row height, which would
          leave nothing for it to stick within. */}
      <div className="md:sticky md:top-[calc(var(--header-height)+var(--space-xxl))] md:self-start">
        <p className="t-mono-eyebrow text-mute">{eyebrow}</p>
        <h2 className="t-display-md mt-lg max-w-[14ch] text-on-primary">{heading}</h2>

        <ol className="mt-xxl hidden md:block" aria-hidden>
          {steps.map((step, i) => (
            <li
              key={step.label}
              className={cn(
                'border-l-2 py-sm pl-md transition-colors duration-500',
                i <= active ? 'border-brand' : 'border-hairline-soft',
              )}
            >
              <span
                className={cn(
                  't-mono-micro block uppercase transition-colors duration-500',
                  i === active ? 'text-on-primary' : 'text-mute',
                )}
              >
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <ol className="mt-xxl md:mt-0">
        {steps.map((step) => (
          <li key={step.label} data-step className="mb-section-lg last:mb-0">
            {/* The rail carries the label on desktop; below that there is no
                rail, so the step has to name itself. */}
            <p className="t-mono-caps text-mute md:hidden">{step.label}</p>
            <Parallax distance={28}>
              <h3 className="t-heading-md mt-sm text-on-primary md:mt-0">{step.title}</h3>
              <p className="t-body mt-md max-w-[46ch] text-ash">{step.body}</p>
            </Parallax>
            <Parallax className="mt-xl" distance={80}>
              <CodeWindow label={step.file} code={step.code} />
            </Parallax>
          </li>
        ))}
      </ol>
    </div>
  );
}
