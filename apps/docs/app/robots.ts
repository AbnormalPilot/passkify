import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';

/**
 * Everything is public and everything is welcome, including the AI crawlers.
 *
 * They are named explicitly rather than left to the wildcard because the most
 * common way a documentation site becomes invisible to assistants is a blanket
 * rule someone added without meaning to. Saying yes out loud is the point.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'cohere-ai',
  'Meta-ExternalAgent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: '/' })),
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  };
}
