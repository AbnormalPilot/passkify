import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { Pre } from '@/components/code-block';
import {
  ApiMethod, Reason, PropList, Prop, Returns, Throws, Throw,
  Callout, Steps, Step, Contrast, ContrastItem, Cards, Card,
} from '@/components/docs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Required by @next/mdx. Every MDX page gets these in scope without importing
 * them, which keeps the content files free of boilerplate.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // Internal links go through next/link so navigation stays client-side.
    a: ({ href, children, ...props }) => {
      const isInternal = typeof href === 'string' && href.startsWith('/');
      if (isInternal) {
        return <Link href={href} {...props}>{children}</Link>;
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      );
    },

    // Wide tables scroll inside their own box rather than widening the page.
    table: ({ children, ...props }) => (
      <div className="table-wrap">
        <table {...props}>{children}</table>
      </div>
    ),

    pre: Pre,

    ApiMethod, Reason, PropList, Prop, Returns, Throws, Throw,
    Callout, Steps, Step, Contrast, ContrastItem, Cards, Card,
    Tabs, TabsList, TabsTrigger, TabsContent,

    ...components,
  };
}
