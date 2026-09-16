/**
 * The landing page's content, kept out of the page component.
 *
 * The figures and the check list are imported from `lib/generated/stats.json`,
 * which `scripts/build-content.mjs` derives from the library's own manifest,
 * check registry, error registry and bundled bytes. They were transcribed by
 * hand once and every one of them had drifted by the time anyone noticed, on a
 * page whose whole argument is that the reader can check it. Prose that names
 * a count reads it from the same place.
 *
 * Nothing here claims an adoption number, a contributor count or a customer,
 * because there are none to claim yet.
 */

import stats from '@/lib/generated/stats.json';

export const STATS = stats;

/** Bytes as the reader would see them quoted, e.g. `3.6`. */
const kb = (bytes: number) => Number((bytes / 1024).toFixed(1));

export interface Measure {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  note: string;
}

export const MEASURES: Measure[] = [
  {
    label: 'Runtime dependencies',
    value: stats.runtimeDependencies,
    note: 'The install tree is this package and nothing else.',
  },
  {
    label: 'Verification checks',
    value: stats.checks.total,
    note: `${stats.checks.registration} on registration and ${stats.checks.authentication} on login, each one a registered assertion in the source.`,
  },
  {
    label: 'Typed error codes',
    value: stats.errorCodes,
    note: 'Every failure arrives as one of these, with an HTTP status attached.',
  },
  {
    label: 'Kilobytes over the wire',
    value: kb(stats.client.gzippedBytes),
    decimals: 1,
    note: 'The client half, minified and compressed. The verifier never ships to a user.',
  },
];

/** The four beats of one login, in the order the code runs them. */
export const CEREMONY = [
  {
    label: 'Challenge',
    title: 'A challenge is issued',
    body: 'Thirty-two random bytes, recorded once against the ceremony and valid for five minutes. Reading it deletes it, so the same challenge cannot be answered twice.',
    file: 'server.ts',
    code: `const options = await passkeys.startAuthentication();

// { challenge: 'Yk3n...', rpId: 'acme.com',
//   userVerification: 'preferred', timeout: 300000 }
res.json(options);`,
  },
  {
    label: 'Signature',
    title: 'The device signs, not the user',
    body: 'The browser will only sign for the domain the credential was made for. A convincing replica of your login page asks the authenticator for a signature and is refused, because the origin does not match.',
    file: 'login.ts',
    code: `import { login } from 'passkify/client';

// Touch ID, Face ID, Windows Hello, or a key
// in the hand. No username, no password field.
const user = await login();`,
  },
  {
    label: 'Verification',
    title: `${stats.checks.authentication} checks, in order`,
    body: 'Origin, domain binding, challenge, flags, signature, counter. Any one of them failing throws a typed error. There is no result object with a boolean on it that a caller can forget to read.',
    file: 'server.ts',
    code: `try {
  const { user } = await passkeys.verifyAuthentication(body);
  req.session.userId = user.id;
} catch (error) {
  if (isPasskeyError(error)) {
    // error.code: 'bad_signature' | 'origin_mismatch' | ...
  }
}`,
  },
  {
    label: 'Session',
    title: 'You receive a user',
    body: 'Then you open the session exactly as you already do. passkify has no opinion about your session library, your user table, or your framework, and it does not want one.',
    file: 'server.ts',
    code: `app.use(passkeys.express({
  onLogin: (req, res, { user }) => {
    req.session.userId = user.id;
  },
}));`,
  },
];

/**
 * The authentication checks, in the order `verifyAuthentication` runs them.
 *
 * Read from the generated registry, so the list on the page is the list the
 * verifier actually walks: adding a check to the server adds a card here, and
 * there is no second copy to forget.
 */
export const CHECKS = stats.checkList.authentication.map((check) => ({
  code: check.code,
  claim: check.title,
}));

export interface Support {
  slug: string;
  name: string;
  /** The section of the documentation that actually covers this target. */
  href: string;
  /** Shown when the target needs something of the reader to work. */
  caveat?: string;
}

/**
 * Every target here has a worked example in the documentation, and each tile
 * links to it. A support grid whose entries go nowhere is a claim; one that
 * links to the code that makes the claim true is a reference.
 */
export const RUNTIMES: Support[] = [
  { slug: 'nodedotjs', name: 'Node 18+', href: '/docs/guides/frameworks#no-framework-at-all' },
  { slug: 'express', name: 'Express', href: '/docs/server/adapters#express' },
  { slug: 'fastify', name: 'Fastify', href: '/docs/guides/frameworks#express-connect-fastify' },
  { slug: 'nextdotjs', name: 'Next.js', href: '/docs/guides/frameworks#nextjs-app-router' },
  { slug: 'remix', name: 'Remix', href: '/docs/guides/frameworks#remix-and-react-router' },
  { slug: 'hono', name: 'Hono', href: '/docs/guides/frameworks#hono' },
  { slug: 'svelte', name: 'SvelteKit', href: '/docs/guides/frameworks#sveltekit' },
  { slug: 'bun', name: 'Bun', href: '/docs/guides/frameworks#bun' },
  { slug: 'deno', name: 'Deno', href: '/docs/guides/frameworks#deno' },
  {
    slug: 'cloudflareworkers',
    name: 'Workers',
    href: '/docs/guides/frameworks#cloudflare-workers',
  },
];

/** Every one of these has a written implementation on the adapters page. */
export const STORES: Support[] = [
  { slug: 'postgresql', name: 'Postgres', href: '/docs/storage/adapters#postgres' },
  { slug: 'prisma', name: 'Prisma', href: '/docs/storage/adapters#prisma' },
  { slug: 'drizzle', name: 'Drizzle', href: '/docs/storage/adapters#drizzle' },
  {
    slug: 'redis',
    name: 'Redis',
    href: '/docs/storage/adapters#redis-for-challenges-only',
    caveat: 'challenges only',
  },
  { slug: 'mongodb', name: 'MongoDB', href: '/docs/storage/adapters#mongodb' },
];

export const TENETS = [
  {
    title: 'Failure throws',
    body: 'There is no verified: false to mistake for success. A library that returns one invites the check that gets forgotten.',
  },
  {
    title: 'One challenge, one attempt',
    body: 'Reading a challenge deletes it, whether verification then succeeds or fails. Replay finds nothing to match.',
  },
  {
    title: 'No account may be claimed',
    body: 'Registration refuses an existing username. Adding a passkey to an account requires a session, never a request body.',
  },
  {
    title: 'The login form tells no tales',
    body: 'An unknown username receives an ordinary challenge. Nobody learns which accounts exist by asking.',
  },
];
