import * as React from 'react';
import { Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/*
 * API reference primitives.
 *
 * The house style is that every documented member carries a reason, not just a
 * description. `<Reason>` is what enforces it: a method without one is visibly
 * incomplete while authoring.
 */

/** Turn a method name into a stable anchor the table of contents can link to. */
function slugify(value: string): string {
  return value
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s.]+/g, '-')
    .toLowerCase();
}

interface ApiMethodProps {
  /** e.g. `startRegistration`. Becomes the heading and the anchor. */
  name: string;
  /** The full call signature, rendered as code under the heading. */
  signature?: string;
  /** `method` (default), `option`, `property`, `type`, `hook`. */
  kind?: string;
  /** Marks something you rarely need. */
  advanced?: boolean;
  children: React.ReactNode;
}

/**
 * One documented member. Renders a real `<h3 id>` so it shows up in the
 * page's table of contents alongside prose headings.
 */
export function ApiMethod({ name, signature, kind = 'method', advanced, children }: ApiMethodProps) {
  const id = slugify(name);
  return (
    <section className="mt-10 scroll-mt-24 first:mt-0">
      <h3 id={id} className="!mt-0 flex flex-wrap items-baseline gap-2.5 font-mono text-[17px] font-medium tracking-[-0.17px]">
        <a href={`#${id}`} className="heading-anchor">{name}</a>
        <Badge variant="outline-light" className="t-mono-micro">{kind}</Badge>
        {advanced && <Badge variant="mono" className="t-mono-micro">advanced</Badge>}
      </h3>
      {signature && (
        <pre className="!mt-3 !text-[12.5px]">
          <code>{signature}</code>
        </pre>
      )}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Why a thing is shaped the way it is.
 *
 * Kept visually distinct from prose so it can be skipped by someone who only
 * needs the signature, and found by someone deciding whether to fight the API.
 */
export function Reason({ title = 'Why it works this way', children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="not-prose rounded-[6px] border-l-2 border-brand bg-canvas-paper p-md">
      <p className="t-mono-caps mb-2 flex items-center gap-1.5 text-graphite">
        <Lightbulb className="size-3" />
        {title}
      </p>
      <div className="space-y-2 text-[15px] leading-normal tracking-[-0.15px] text-ink-soft [&_a]:text-link-blue [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-hairline [&_code]:bg-canvas-paper [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]">
        {children}
      </div>
    </div>
  );
}

/** A list of parameters, options or fields. */
export function PropList({ children }: { children: React.ReactNode }) {
  return (
    <div className="not-prose overflow-hidden rounded-[12px] border border-hairline bg-canvas-light">
      <div className="divide-y divide-hairline">{children}</div>
    </div>
  );
}

interface PropProps {
  name: string;
  type: string;
  /** Rendered as `default: x`. Omit for required values. */
  defaultValue?: string;
  required?: boolean;
  children: React.ReactNode;
}

/** One parameter or option, with its type, default, and the reason it exists. */
export function Prop({ name, type, defaultValue, required, children }: PropProps) {
  return (
    <div className="p-md">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <code className="font-mono text-[14px] font-medium text-ink">{name}</code>
        <code className="font-mono text-[13px] text-graphite">{type}</code>
        {required && (
          <span className="t-mono-micro rounded-full bg-ink px-2 py-px uppercase text-on-primary">
            required
          </span>
        )}
        {defaultValue && (
          <span className="font-mono text-[12px] text-graphite">
            default <span className="text-ink-soft">{defaultValue}</span>
          </span>
        )}
      </div>
      <div className="mt-1.5 space-y-2 text-[15px] leading-normal tracking-[-0.15px] text-ink-soft [&_a]:text-link-blue [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-hairline [&_code]:bg-canvas-paper [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </div>
  );
}

/** What a method returns. */
export function Returns({ type, children }: { type: string; children?: React.ReactNode }) {
  return (
    <div className="not-prose rounded-[12px] border border-hairline bg-canvas-light p-md">
      <p className="t-mono-caps mb-2 text-graphite">Returns</p>
      <code className="font-mono text-[13px] text-ink">{type}</code>
      {children && (
        <div className="mt-1.5 text-[15px] leading-normal tracking-[-0.15px] text-ink-soft [&_a]:text-link-blue [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-hairline [&_code]:bg-canvas-paper [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]">
          {children}
        </div>
      )}
    </div>
  );
}

/** The error codes a method can throw, and what each one means here. */
export function Throws({ children }: { children: React.ReactNode }) {
  return (
    <div className="not-prose overflow-hidden rounded-[12px] border border-ink">
      <p className="t-mono-caps bg-ink px-md py-2 text-on-primary">
        Throws
      </p>
      <div className="divide-y divide-hairline">{children}</div>
    </div>
  );
}

export function Throw({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <div className="p-md">
      <code className="font-mono text-[13px] font-medium text-error">{code}</code>
      <div className="mt-1 text-[15px] leading-normal tracking-[-0.15px] text-ink-soft [&_a]:text-link-blue [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-hairline [&_code]:bg-canvas-paper [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]">
        {children}
      </div>
    </div>
  );
}
