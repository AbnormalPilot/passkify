/**
 * The documentation tree.
 *
 * One source of truth: the sidebar, the previous/next pager and the search
 * index all read from here, so a page cannot appear in one and be missing from
 * another. `description` is what search matches on, so write it as the thing a
 * reader would actually type.
 */

export interface NavItem {
  title: string;
  href: string;
  description: string;
  /** Shown as a small tag in the sidebar and search results. */
  label?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const docsNav: NavSection[] = [
  {
    title: 'Getting started',
    items: [
      {
        title: 'Introduction',
        href: '/docs',
        description: 'What passkify does, what it deliberately does not do, and how the pieces fit.',
      },
      {
        title: 'Installation',
        href: '/docs/installation',
        description: 'Install the package, pick your entry points, and check runtime requirements.',
      },
      {
        title: 'Quickstart',
        href: '/docs/quickstart',
        description: 'A working passwordless sign-up and sign-in, end to end, in about five minutes.',
      },
      {
        title: 'How passkeys work',
        href: '/docs/how-passkeys-work',
        description: 'Relying Party ID, challenges, user handles, discoverable credentials.',
      },
      {
        title: 'Examples',
        href: '/docs/examples',
        description: 'Complete runnable apps for Express and Next.js, with every file listed.',
      },
    ],
  },
  {
    title: 'Server',
    items: [
      {
        title: 'PasskeyServer',
        href: '/docs/server/passkey-server',
        description: 'The one object you construct, and every method it exposes.',
      },
      {
        title: 'Configuration',
        href: '/docs/server/configuration',
        description: 'Every option on PasskeyServerConfig, what it changes, and when to move it.',
      },
      {
        title: 'Registration',
        href: '/docs/server/registration',
        description: 'startRegistration and finishRegistration, and the fifteen checks in between.',
      },
      {
        title: 'Authentication',
        href: '/docs/server/authentication',
        description: 'startAuthentication and finishAuthentication, usernameless and username-first.',
      },
      {
        title: 'Credential management',
        href: '/docs/server/credentials',
        description: 'Listing, renaming and revoking passkeys from an account settings page.',
      },
      {
        title: 'HTTP adapters',
        href: '/docs/server/adapters',
        description: 'The Express middleware, the fetch handler, and the routes they mount.',
      },
    ],
  },
  {
    title: 'Browser',
    items: [
      {
        title: 'Client API',
        href: '/docs/client',
        description: 'register, login, autofill, capability detection, and the low-level ceremony calls.',
      },
    ],
  },
  {
    title: 'Storage',
    items: [
      {
        title: 'PasskeyStore',
        href: '/docs/storage',
        description: 'The ten-method persistence contract and the three rules that matter.',
      },
      {
        title: 'Store adapters',
        href: '/docs/storage/adapters',
        description: 'Working implementations for Postgres, Prisma, Drizzle, Redis and MongoDB.',
      },
    ],
  },
  {
    title: 'Reference',
    items: [
      {
        title: 'Errors',
        href: '/docs/errors',
        description: 'Every PasskeyError code, what causes it, and what to do about it.',
      },
      {
        title: 'Types',
        href: '/docs/types',
        description: 'Every exported interface and type alias.',
      },
      {
        title: 'Low-level primitives',
        href: '/docs/low-level',
        description: 'CBOR, COSE keys, authenticator data. For tooling, not for websites.',
        label: 'Advanced',
      },
    ],
  },
  {
    title: 'Guides',
    items: [
      {
        title: 'Frameworks',
        href: '/docs/guides/frameworks',
        description: 'Express, Next.js, Hono, SvelteKit, Remix, Bun, Deno, Cloudflare Workers.',
      },
      {
        title: 'Adding to an existing app',
        href: '/docs/guides/existing-app',
        description: 'Staged rollout alongside passwords, without opening an account-takeover hole.',
      },
      {
        title: 'Security model',
        href: '/docs/guides/security',
        description: 'The full verification checklist, design decisions, and what stays your job.',
      },
      {
        title: 'Troubleshooting',
        href: '/docs/guides/troubleshooting',
        description: 'NotAllowedError, origin_mismatch, challenge_not_found, testing on a phone.',
      },
    ],
  },
  {
    title: 'Resources',
    items: [
      {
        title: 'FAQ',
        href: '/docs/faq',
        description: 'Short answers to the questions that come up before and during adoption.',
      },
      {
        title: 'Changelog',
        href: '/docs/changelog',
        description: 'Release history, and the compatibility promise for each part of the API.',
      },
    ],
  },
];

/** The tree flattened into reading order, for the pager and for search. */
export const flatNav: NavItem[] = docsNav.flatMap((section) => section.items);

export function getPagerLinks(pathname: string): {
  previous: NavItem | null;
  next: NavItem | null;
} {
  const index = flatNav.findIndex((item) => item.href === pathname);
  if (index === -1) {
    return { previous: null, next: null };
  }
  return {
    previous: index > 0 ? flatNav[index - 1] : null,
    next: index < flatNav.length - 1 ? flatNav[index + 1] : null,
  };
}

/** The section a page belongs to, used for the breadcrumb. */
export function getSectionTitle(pathname: string): string | null {
  for (const section of docsNav) {
    if (section.items.some((item) => item.href === pathname)) {
      return section.title;
    }
  }
  return null;
}

/**
 * External destinations. Neither is a documentation link: everything a reader
 * needs is under /docs, and these point at the source and the registry only.
 */
export const siteLinks = {
  github: 'https://github.com/USER/passkify',
  npm: 'https://www.npmjs.com/package/passkify',
};

/** Top-level entries in the header, each jumping to the first page of a group. */
export const headerNav = [
  { title: 'Docs', href: '/docs' },
  { title: 'Demo', href: '/demo' },
  { title: 'Server API', href: '/docs/server/passkey-server' },
  { title: 'Client API', href: '/docs/client' },
  { title: 'Guides', href: '/docs/guides/frameworks' },
  { title: 'Examples', href: '/docs/examples' },
];

/** Grouped links for the site footer. Internal only, by design. */
export const footerNav: NavSection[] = [
  {
    title: 'Getting started',
    items: docsNav[0].items.slice(0, 4),
  },
  {
    title: 'Reference',
    items: [
      ...docsNav[1].items.slice(0, 3),
      ...docsNav[4].items.slice(0, 2),
    ],
  },
  {
    title: 'Guides',
    items: docsNav[5].items,
  },
];
