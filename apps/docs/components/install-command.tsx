'use client';

import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * For a library, copying the install line is the first action a reader
 * actually takes, so it is a control rather than a link.
 *
 * It sits in the pill language because it is a marketing CTA, but the command
 * inside it is set in mono — the labelling face — which is where the system
 * lets the technical register show through on an otherwise editorial surface.
 *
 * Full feedback cycle: idle, copied, and a fallback instruction when the
 * clipboard is unavailable. A button that silently does nothing is worse than
 * no button.
 */
export function InstallCommand({
  className,
  tone = 'dark',
}: {
  className?: string;
  /** `dark` sits on canvas; `light` sits on canvas-light or canvas-paper. */
  tone?: 'dark' | 'light';
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText('npm i passkify');
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 2000);
  }, []);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy the install command"
      className={cn(
        'btn-pill group gap-md font-mono text-[15px]',
        tone === 'dark'
          ? 'border border-hairline-soft bg-canvas-soft text-ash hover:text-on-primary'
          : 'border border-hairline bg-canvas-paper text-ink-soft hover:text-ink',
        className,
      )}
    >
      <span>
        <span className="text-mute">$</span> npm i passkify
      </span>
      <span
        className={cn(
          't-mono-micro uppercase transition-colors',
          tone === 'dark' ? 'text-mute group-hover:text-ash' : 'text-graphite',
        )}
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? '⌘C' : 'Copy'}
      </span>
    </button>
  );
}
