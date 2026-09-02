import { cn } from '@/lib/utils';

/**
 * The system's primary identification mark: a coral dot, 8px to the left of
 * the wordmark. The pairing is required wherever the wordmark appears above
 * 24px, and the dot is never substituted for a logo glyph.
 */
export function BrandMark({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const type = {
    sm: 'text-[15px] tracking-[-0.15px]',
    md: 'text-[18px] tracking-[-0.18px]',
    lg: 't-heading-sm',
  }[size];

  return (
    <span className={cn('inline-flex items-center gap-[8px]', className)}>
      <span className="brand-dot" aria-hidden />
      <span className={cn('font-sans', type)}>passkify</span>
    </span>
  );
}
