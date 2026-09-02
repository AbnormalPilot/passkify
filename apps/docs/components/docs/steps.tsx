import * as React from 'react';

/** Numbered sequence, for guides where order is the content. */

export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-3 border-l border-hairline pl-7 [counter-reset:step]">{children}</div>
  );
}

export function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative mb-8 last:mb-0 [counter-increment:step]">
      <span className="absolute -left-[2.55rem] top-0 flex size-7 items-center justify-center rounded-full bg-ink font-mono text-[12px] text-on-primary before:content-[counter(step)]" />
      <h4 className="t-subtitle !mt-0 mb-2 text-ink">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
