/**
 * Facts about the deployment that more than one file needs.
 *
 * `NEXT_PUBLIC_SITE_ORIGIN` already exists for the demo's rpID, and reusing it
 * here is deliberate: the origin a ceremony is validated against and the origin
 * a canonical URL points at must never be two different strings.
 */

import pkg from '../../../packages/passkify/package.json';

/** Canonical origin, scheme included, no trailing slash. */
export const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, '') ?? 'https://passkify.himanshubuilds.in';

/** The published library version. Read from the package, never typed by hand. */
export const LIBRARY_VERSION: string = pkg.version;

export const REPO_URL = 'https://github.com/AbnormalPilot/passkify';
export const NPM_URL = 'https://www.npmjs.com/package/passkify';

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
