'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Wraps every fenced code block with a copy button.
 *
 * The text is read from the rendered DOM rather than passed as a prop, because
 * by the time MDX hands us `children` the content is a Shiki-highlighted React
 * tree, and reconstructing the source from it is guesswork.
 */
export function Pre({ className, children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const ref = React.useRef<HTMLPreElement>(null);
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const copy = React.useCallback(async () => {
    const text = ref.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
  }, []);

  return (
    <div className="group relative">
      <pre ref={ref} className={className} {...props}>
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className={cn(
          'absolute right-2 top-2 flex h-7 items-center gap-1.5 rounded-[4px] border border-hairline-soft bg-canvas-soft px-2 font-mono text-[11px] uppercase tracking-[0.06em] text-mute opacity-0 transition-all',
          'hover:text-ash focus-visible:opacity-100 group-hover:opacity-100',
          copied && 'border-brand text-brand opacity-100',
        )}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {failed ? 'Press ⌘C' : copied ? 'Copied' : null}
      </button>
    </div>
  );
}
