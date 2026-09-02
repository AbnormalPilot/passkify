'use client';

import { Parallax } from '@/components/motion/parallax';

export interface Check {
  code: string;
  claim: string;
}

/** How far each column travels across its crossing, nearest column last. */
const DRIFT = [56, 112, 84];

/** A resting offset per column, so the columns do not start on one line. */
const OFFSET = ['', 'lg:mt-xxl', 'lg:mt-lg'];

/**
 * Split into consecutive runs rather than dealing round-robin.
 *
 * The checks are in source order and are numbered on screen, so the order has
 * to survive the layout. Consecutive runs read 01–05 down the first column and
 * 06–09 down the second, and — the reason it matters — when the columns stack
 * below `lg` they concatenate back into 01–13. A round-robin deal would read
 * correctly at one breakpoint and shuffle at every other.
 */
function columnise<T>(items: T[], count: number): T[][] {
  const columns: T[][] = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const size = Math.ceil((items.length - start) / (count - i));
    columns.push(items.slice(start, start + size));
    start += size;
  }
  return columns;
}

/**
 * The verification list, as three columns at different depths.
 *
 * Thirteen items is too many for a single vertical list and too few to hide
 * behind a "view all", and the point being made is breadth: that the checks
 * keep coming. Three columns put the whole set on screen at once, which is the
 * claim, and giving each column its own drift rate keeps the block from
 * reading as one static slab as it passes.
 *
 * The drift is small next to the card it moves — enough that the columns are
 * visibly not locked together, not so much that a reader has to track a moving
 * target to finish a sentence. The columns are furthest apart while the
 * section is arriving and closest as it centres, so the set is at its most
 * settled exactly when it is being read.
 *
 * Below 768px, and under `prefers-reduced-motion`, nothing moves: the columns
 * stack into one ordered list of thirteen cards.
 */
export function ChecksColumns({
  eyebrow,
  heading,
  standfirst,
  checks,
}: {
  eyebrow: string;
  heading: string;
  standfirst: string;
  checks: Check[];
}) {
  const columns = columnise(
    checks.map((check, index) => ({ check, index })),
    DRIFT.length,
  );

  return (
    <div className="container-editorial">
      <p className="t-mono-eyebrow text-mute">{eyebrow}</p>
      <h2 className="t-display-md mt-lg max-w-[22ch] text-on-primary">{heading}</h2>
      <p className="t-subtitle mt-lg max-w-[54ch] text-ash">{standfirst}</p>

      <div className="mt-section-lg grid gap-lg md:grid-cols-2 lg:grid-cols-3 lg:items-start">
        {columns.map((column, c) => (
          <Parallax key={column[0].index} distance={DRIFT[c]} className={OFFSET[c]}>
            {/* `start` keeps the list's own numbering honest where the column
                does not begin at one; the printed number is the same value. */}
            <ol start={column[0].index + 1} className="grid gap-lg">
              {column.map(({ check, index }) => (
                <li key={`${check.code}-${index}`} className="card-dark">
                  <p className="t-mono-micro uppercase text-mute">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <p className="mt-lg font-mono text-[14px] text-brand">{check.code}</p>
                  <p className="t-body mt-sm text-ash">{check.claim}</p>
                </li>
              ))}
            </ol>
          </Parallax>
        ))}
      </div>
    </div>
  );
}
