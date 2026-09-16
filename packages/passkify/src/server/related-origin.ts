/**
 * Related Origin Requests (WebAuthn Level 3, §5.9).
 *
 * One passkey, several domains. A user who registered on `example.com` can sign
 * in on `example.de` or `example.co.uk`, because the browser fetches
 * `https://<rpId>/.well-known/webauthn` and checks the origin it is running on
 * against the list there.
 *
 * The thing that goes wrong with this feature is drift: the published file says
 * one set of origins, the server accepts another, and the failure is silent and
 * one-sided — the browser refuses a ceremony the server would have been happy
 * with. So there is no second list to configure. The file is derived from
 * `origin`, the same array `originAllowed` reads, and the cases where a
 * derivation is impossible are refused at construction.
 *
 * Browser support: Chrome/Edge 128+, Safari 18+, Firefox 152+.
 */

import { PasskeyError } from '../shared/errors.js';
import type { OriginMatcher } from './crypto/client-data.js';

/**
 * Multi-part public suffixes, enough to classify the domains a site is
 * realistically deployed on.
 *
 * The correct source is the Public Suffix List, which is ~250 KB and would be
 * this package's first dependency. Instead: a short table, and a count that is
 * honest about its own uncertainty — see `countLabels`.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'net.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'id.au',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  'go.jp',
  'com.br',
  'net.br',
  'org.br',
  'gov.br',
  'co.in',
  'net.in',
  'org.in',
  'gen.in',
  'firm.in',
  'ind.in',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'co.nz',
  'net.nz',
  'org.nz',
  'govt.nz',
  'co.za',
  'org.za',
  'net.za',
  'com.mx',
  'com.ar',
  'com.tr',
  'com.sg',
  'com.hk',
  'com.tw',
  'com.my',
  'co.kr',
  'or.kr',
  'ne.kr',
  'co.il',
  'org.il',
  'net.il',
  'com.pl',
  'com.ua',
  'com.vn',
  'com.ph',
  'com.co',
  'com.pe',
  'com.ec',
  'github.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'herokuapp.com',
  'azurewebsites.net',
  'appspot.com',
  'firebaseapp.com',
]);

/**
 * The browser caps the list at five distinct eTLD+1 *labels* — not five
 * origins. `amazon.com`, `amazon.de` and `amazon.co.uk` are one label
 * ("amazon"); `audible.com` is a second. Entries past the cap are ignored
 * silently, which is the worst way to fail: three domains work in development,
 * seven break in production.
 */
export const MAX_RELATED_ORIGIN_LABELS = 5;

export interface LabelCount {
  /** Labels assuming every suffix is single-part — the smallest plausible count. */
  optimistic: Set<string>;
  /** Labels assuming multi-part suffixes we do not know about — the largest. */
  pessimistic: Set<string>;
  /** Hosts whose registrable part could not be determined confidently. */
  ambiguous: string[];
}

/** The registrable label of a host, under both readings of its suffix. */
export function countLabels(origins: readonly string[]): LabelCount {
  const optimistic = new Set<string>();
  const pessimistic = new Set<string>();
  const ambiguous: string[] = [];

  for (const origin of origins) {
    let host: string;
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch {
      continue;
    }

    const parts = host.split('.');
    if (parts.length < 2) {
      // A single-label host: localhost, or an intranet name.
      optimistic.add(host);
      pessimistic.add(host);
      continue;
    }

    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(lastTwo)) {
      // example.co.uk -> "example"
      const label = parts.length >= 3 ? parts[parts.length - 3] : lastTwo;
      optimistic.add(label);
      pessimistic.add(label);
      continue;
    }

    // example.com -> "example". If the suffix is really multi-part and we do
    // not know it, the true label is one further left.
    optimistic.add(parts[parts.length - 2]);
    pessimistic.add(parts.length >= 3 ? parts[parts.length - 3] : parts[parts.length - 2]);
    if (parts.length >= 3) ambiguous.push(host);
  }

  return { optimistic, pessimistic, ambiguous };
}

export interface RelatedOriginsConfig {
  /**
   * Declare the registrable labels yourself, when the suffix table cannot work
   * them out — a country-code suffix it does not list, for instance.
   */
  labels?: readonly string[];
}

let warnedAboutAmbiguity = false;

/**
 * Build the `/.well-known/webauthn` body from the configured origins.
 *
 * Throws `configuration_error` when the origin list cannot be published: a
 * `RegExp` or predicate matcher has no serialisable form, so the server would
 * accept origins the file omits and browsers would refuse ceremonies the server
 * would have allowed.
 */
export function buildRelatedOrigins(
  rpID: string,
  matchers: readonly OriginMatcher[],
  options: RelatedOriginsConfig = {},
): { origins: string[] } {
  const dynamic = matchers.filter((matcher) => typeof matcher !== 'string');
  if (dynamic.length > 0) {
    throw new PasskeyError(
      'configuration_error',
      'relatedOrigins is enabled, but `origin` contains a RegExp or a function. ' +
        'Related Origin Requests publish a literal list of origins to ' +
        '/.well-known/webauthn, so every origin has to be a plain string. ' +
        'List them explicitly, or turn relatedOrigins off and accept that ' +
        'cross-domain ceremonies will fail.',
    );
  }

  const origins = matchers.filter((matcher): matcher is string => typeof matcher === 'string');

  // Deterministic, with the relying party's own origin first: if a browser does
  // truncate at the cap, it truncates the same way on every deploy rather than
  // differently depending on object iteration order.
  const own = origins.filter((origin) => {
    try {
      return new URL(origin).hostname === rpID;
    } catch {
      return false;
    }
  });
  const rest = origins.filter((origin) => !own.includes(origin)).sort();
  const ordered = [...new Set([...own, ...rest])];

  const counted = countLabels(ordered);
  const declared = options.labels ? new Set(options.labels) : undefined;
  const effective = declared ?? counted.optimistic;

  if (effective.size > MAX_RELATED_ORIGIN_LABELS) {
    throw new PasskeyError(
      'configuration_error',
      `relatedOrigins covers ${effective.size} registrable labels ` +
        `(${[...effective].join(', ')}), and browsers stop after ` +
        `${MAX_RELATED_ORIGIN_LABELS}. Entries past the limit are ignored ` +
        'silently, so reduce the list rather than shipping one that half works.',
    );
  }

  if (
    !declared &&
    counted.pessimistic.size > MAX_RELATED_ORIGIN_LABELS &&
    counted.ambiguous.length > 0 &&
    !warnedAboutAmbiguity
  ) {
    warnedAboutAmbiguity = true;
    console.warn(
      `[passkify] relatedOrigins may exceed the ${MAX_RELATED_ORIGIN_LABELS}-label browser ` +
        `limit. passkify could not determine the registrable domain of: ` +
        `${counted.ambiguous.join(', ')}. Set relatedOrigins.labels to declare them.`,
    );
  }

  return { origins: ordered };
}

/** The absolute path browsers fetch. It is fixed, and cannot be moved. */
export const WELL_KNOWN_WEBAUTHN_PATH = '/.well-known/webauthn';
