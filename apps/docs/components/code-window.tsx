import { cn } from '@/lib/utils';

/**
 * The framed product surface.
 *
 * Corners are cut at 6px rather than the 12px marketing radius, and the chrome
 * bar carries the three macOS dots — both so the frame reads as real
 * application chrome rather than as another card. It is the system's recurring
 * "this is a real product, not a marketing diagram" signal.
 */
export function CodeWindow({
  label,
  code,
  className,
}: {
  label: string;
  code: string;
  className?: string;
}) {
  return (
    <figure className={cn('app-window', className)}>
      <div className="app-window-chrome">
        <span className="app-window-dot bg-[#ff5f57]" aria-hidden />
        <span className="app-window-dot bg-[#febc2e]" aria-hidden />
        <span className="app-window-dot bg-[#28c840]" aria-hidden />
        <figcaption className="t-mono-caps ml-sm text-mute">{label}</figcaption>
      </div>
      <pre className="thin-scroll overflow-x-auto p-md font-mono text-[13px] leading-[1.7] text-ash">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
