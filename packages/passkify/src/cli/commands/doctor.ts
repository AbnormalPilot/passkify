/**
 * `passkify doctor` — find the integration mistakes before a user does.
 *
 * Every check here maps to a real support question. The order is roughly the
 * order in which things go wrong, and each failure prints the fix rather than
 * only the symptom, because "rpID is invalid" without the correction is not
 * meaningfully better than the runtime error it is trying to pre-empt.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { style, symbol, type ParsedArgs } from '../args.js';

type Level = 'pass' | 'warn' | 'fail';

interface Finding {
  level: Level;
  title: string;
  detail?: string;
  fix?: string;
}

const findings: Finding[] = [];
const pass = (title: string) => findings.push({ level: 'pass', title });
const warn = (title: string, detail?: string, fix?: string) =>
  findings.push({ level: 'warn', title, detail, fix });
const fail = (title: string, detail?: string, fix?: string) =>
  findings.push({ level: 'fail', title, detail, fix });

/** Source files worth scanning, skipping the places code is not written. */
function projectFiles(root: string, limit = 4000): string[] {
  const out: string[] = [];
  const skip = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.svelte-kit',
    'coverage',
  ]);

  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry) || entry.startsWith('.')) continue;
      const path = join(dir, entry);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue)$/.test(entry)) out.push(path);
    }
  };
  walk(root);
  return out;
}

export async function doctorCommand(args: ParsedArgs): Promise<number> {
  const root = process.cwd();
  console.log(`${style.bold('passkify doctor')}  ${style.dim(root)}\n`);

  checkEnvironment(root);
  const sources = projectFiles(root);
  checkConfiguration(sources);
  checkWiring(sources);
  checkCustomStore(sources);

  const url = typeof args.flags.serve === 'string' ? args.flags.serve : undefined;
  if (url) await checkLive(url);

  for (const finding of findings) {
    const mark =
      finding.level === 'pass' ? symbol.pass : finding.level === 'warn' ? symbol.warn : symbol.fail;
    console.log(`${mark} ${finding.title}`);
    if (finding.detail) console.log(`  ${style.dim(finding.detail)}`);
    if (finding.fix) console.log(`  ${style.cyan('fix:')} ${finding.fix}`);
  }

  const failures = findings.filter((f) => f.level === 'fail').length;
  const warnings = findings.filter((f) => f.level === 'warn').length;
  console.log(
    `\n${style.bold(`${findings.length - failures - warnings} passed, ${warnings} warning${warnings === 1 ? '' : 's'}, ${failures} problem${failures === 1 ? '' : 's'}`)}`,
  );
  if (!url) {
    console.log(style.dim('Add --serve http://localhost:3000 to also probe a running app.'));
  }
  return failures > 0 ? 1 : 0;
}

function checkEnvironment(root: string): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) pass(`Node ${process.versions.node}`);
  else
    fail(
      `Node ${process.versions.node} is too old`,
      'passkify needs WebCrypto.',
      'Upgrade to Node 20 or newer.',
    );

  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) {
    warn('no package.json here', 'Run doctor from your project root.');
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const declared = { ...manifest.dependencies, ...manifest.devDependencies }.passkify;
  if (declared) pass(`passkify is a dependency (${declared})`);
  else warn('passkify is not in package.json', 'Running doctor outside the project that uses it?');

  // Two copies means two PasskeyError classes, and `instanceof` silently fails.
  const nested = join(root, 'node_modules', 'passkify');
  if (existsSync(nested)) {
    const duplicates = findDuplicates(join(root, 'node_modules'));
    if (duplicates.length > 1) {
      fail(
        `${duplicates.length} copies of passkify are installed`,
        'Two copies mean two PasskeyError classes, so `instanceof` returns false and your error handling silently stops working.',
        'Deduplicate with `npm dedupe`, or align the versions your dependencies ask for.',
      );
    } else {
      pass('exactly one copy of passkify is installed');
    }
  }

  const tsconfigPath = join(root, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    const text = readFileSync(tsconfigPath, 'utf8');
    const resolution = /"moduleResolution"\s*:\s*"([^"]+)"/i.exec(text)?.[1]?.toLowerCase();
    if (resolution && !['bundler', 'node16', 'nodenext'].includes(resolution)) {
      fail(
        `tsconfig moduleResolution is "${resolution}"`,
        'passkify ships subpath exports, which the legacy "node" resolution cannot see — `passkify/server` will not resolve.',
        'Set "moduleResolution": "bundler" (or "nodenext").',
      );
    } else if (resolution) {
      pass(`tsconfig moduleResolution is "${resolution}"`);
    }
  }
}

function findDuplicates(modulesDir: string, depth = 0): string[] {
  if (depth > 3) return [];
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(modulesDir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry === 'passkify') found.push(join(modulesDir, entry));
    const nested = join(modulesDir, entry, 'node_modules');
    if (existsSync(nested)) found.push(...findDuplicates(nested, depth + 1));
  }
  return found;
}

function checkConfiguration(sources: string[]): void {
  const withServer = sources.filter((file) =>
    readFileSync(file, 'utf8').includes('new PasskeyServer('),
  );
  if (withServer.length === 0) {
    warn(
      'no `new PasskeyServer(` found',
      'Nothing to check. Is the server built somewhere generated?',
    );
    return;
  }
  pass(`found PasskeyServer in ${withServer.length} file${withServer.length === 1 ? '' : 's'}`);

  for (const file of withServer) {
    const text = readFileSync(file, 'utf8');

    const origin = /origin\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1];
    const rpID = /rpID\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1];

    if (origin) {
      if (!/^https?:\/\//.test(origin)) {
        fail(`origin "${origin}" has no scheme`, undefined, `Use "https://${origin}".`);
      } else if (
        origin.startsWith('http://') &&
        !/^http:\/\/(localhost|127\.0\.0\.1)/.test(origin)
      ) {
        fail(
          `origin "${origin}" is plain http`,
          'WebAuthn requires a secure context. Only localhost is exempt.',
          'Serve over https.',
        );
      } else {
        pass(`origin "${origin}" looks right`);
      }
    }

    if (rpID) {
      if (rpID.includes(':') || rpID.includes('/')) {
        fail(
          `rpID "${rpID}" is not a bare hostname`,
          'It must have no scheme, no port and no path.',
          `Use "${rpID.replace(/^https?:\/\//, '').split(/[:/]/)[0]}".`,
        );
      } else if (origin) {
        try {
          const host = new URL(origin).hostname;
          if (host === rpID || host.endsWith(`.${rpID}`)) pass(`rpID "${rpID}" matches the origin`);
          else if (!text.includes('relatedOrigins')) {
            fail(
              `rpID "${rpID}" does not cover origin "${origin}"`,
              'The rpID must be the origin host or a registrable parent of it.',
              `Use rpID "${host}", or enable relatedOrigins if these are genuinely different domains you own.`,
            );
          }
        } catch {
          // An origin that will not parse is already reported above.
        }
      }
    }

    // An unanchored RegExp origin matches far more than it looks like it does.
    for (const match of text.matchAll(/origin\s*:\s*\[?[^\]\n]*?\/(\^?)([^/\n]+?)(\$?)\//g)) {
      if (match[1] !== '^' || match[3] !== '$') {
        fail(
          'a RegExp origin matcher is not anchored',
          'An unanchored pattern matches anywhere in the string, so "https://evil.com/?x=https://example.com" can pass.',
          'Anchor it: /^https:\\/\\/([a-z0-9-]+\\.)?example\\.com$/',
        );
        break;
      }
    }

    if (/store\s*:\s*new MemoryStore\(/.test(text)) {
      warn(
        'MemoryStore is in use',
        'It is development-only. Across more than one worker it produces intermittent challenge_not_found, because the challenge is issued by one process and redeemed by another.',
        'Use passkify/stores/postgres, /prisma, /redis, /mongodb or /sqlite.',
      );
    }

    if (
      /attestation\s*:\s*['"](direct|enterprise)['"]/.test(text) &&
      !text.includes('attestationRootCertificates')
    ) {
      warn(
        'attestation is requested without root certificates',
        'A scarier consent prompt for a guarantee you cannot check: without roots, `trusted` is false for every credential.',
        "Set attestation: 'none' unless you have a specific reason and the roots to verify against.",
      );
    }

    if (/requireBackupEligible\s*:\s*true/.test(text)) {
      warn(
        'requireBackupEligible is on',
        'This refuses every hardware security key, since they cannot sync.',
        'Leave it off unless you have decided to exclude YubiKeys deliberately.',
      );
    }
  }
}

function checkWiring(sources: string[]): void {
  let basePath: string | undefined;
  let clientBaseUrl: string | undefined;
  let hasSessionHook = false;
  let hasAutofill = false;
  let autofillInputOk = false;

  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    basePath ??= /basePath\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1];
    clientBaseUrl ??= /baseUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1];
    if (/onLogin|onRegister|onAuthenticated/.test(text)) hasSessionHook = true;
    if (/signInWithAutofill|usePasskeyAutofill/.test(text)) hasAutofill = true;
    if (
      /autocomplete=["'`][^"'`]*webauthn/i.test(text) ||
      /autoComplete=["'{][^"'}]*webauthn/i.test(text)
    ) {
      autofillInputOk = true;
    }
  }

  if (basePath && clientBaseUrl && basePath !== clientBaseUrl) {
    fail(
      `the client points at "${clientBaseUrl}" but the server is mounted at "${basePath}"`,
      'Every ceremony will 404 or 500. This is the most common wiring mistake there is.',
      `Set configure({ baseUrl: '${basePath}' }) in the browser.`,
    );
  } else if (basePath) {
    pass(`routes mounted at "${basePath}"`);
  }

  if (hasSessionHook) {
    pass('a session hook is present (onLogin / onRegister / onAuthenticated)');
  } else {
    warn(
      'no session hook found',
      'Verification succeeds, no session is created, and the app appears to do nothing — with no error anywhere.',
      'Set your session in onLogin and onRegister.',
    );
  }

  if (hasAutofill && !autofillInputOk) {
    warn(
      'autofill is used but no input has autocomplete="username webauthn"',
      'Without the webauthn token the dropdown never offers a passkey, and nothing reports it.',
      'Add autocomplete="username webauthn" to the sign-in input.',
    );
  } else if (hasAutofill) {
    pass('autofill input carries the webauthn token');
  }

  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('passkeyRoutes') && !text.includes('PasskeyServer')) continue;
    if (file.includes(`${'app'}/`) && /route\.(ts|js)$/.test(file)) {
      // `passkeyRoutes` returns both, so a destructured re-export counts:
      //   export const { GET, POST, runtime, dynamic } = passkeyRoutes(...)
      const reExports = /export\s+const\s*\{[^}]*\bruntime\b[^}]*\}\s*=\s*passkeyRoutes/.test(text);
      if (!reExports && !/runtime\s*=\s*['"]nodejs['"]/.test(text)) {
        warn(
          `${file} does not export runtime = 'nodejs'`,
          'On the edge runtime a database driver usually will not load.',
          "Add: export const runtime = 'nodejs';",
        );
      }
      const reExportsDynamic =
        /export\s+const\s*\{[^}]*\bdynamic\b[^}]*\}\s*=\s*passkeyRoutes/.test(text);
      if (!reExportsDynamic && !/dynamic\s*=\s*['"]force-dynamic['"]/.test(text)) {
        warn(
          `${file} does not export dynamic = 'force-dynamic'`,
          'A cached challenge is a replayable one.',
          "Add: export const dynamic = 'force-dynamic';",
        );
      }
    }
  }
}

function checkCustomStore(sources: string[]): void {
  const storeFiles = sources.filter((file) => {
    const text = readFileSync(file, 'utf8');
    return text.includes('takeChallenge') && !text.includes('passkify/stores/');
  });
  if (storeFiles.length === 0) return;

  for (const file of storeFiles) {
    const text = readFileSync(file, 'utf8');
    const body = text.slice(text.indexOf('takeChallenge'), text.indexOf('takeChallenge') + 900);

    if (!/DELETE|GETDEL|getdel|findOneAndDelete|\.delete\(|deleteOne|del\(/i.test(body)) {
      fail(
        `${file}: takeChallenge does not appear to delete anything`,
        'A challenge that survives being taken can be replayed. It must fetch and delete atomically.',
        'Use DELETE ... RETURNING, GETDEL, or findOneAndDelete.',
      );
    } else if (/const .*=\s*await[\s\S]{0,120}\n[\s\S]{0,120}await[\s\S]{0,60}delete/i.test(body)) {
      warn(
        `${file}: takeChallenge may read and then delete`,
        'Two concurrent requests can both pass the read before either deletes, which permits replay.',
        'Make it one statement: DELETE ... RETURNING.',
      );
    } else {
      pass(`${file}: takeChallenge deletes atomically`);
    }

    if (/createUser[\s\S]{0,400}(randomUUID|nanoid|cuid|uuidv4|Math\.random)/.test(text)) {
      fail(
        `${file}: createUser appears to generate its own id`,
        'The id is the WebAuthn user handle. The authenticator stores it and returns it on every usernameless login, so a generated one means those logins never find the account.',
        'Persist input.id exactly as given.',
      );
    }
  }

  console.log(
    style.dim(
      '  Run the full contract with: import { runStoreConformance } from "passkify/store-conformance"\n',
    ),
  );
}

async function checkLive(url: string): Promise<void> {
  const base = url.replace(/\/$/, '');
  for (const path of ['/passkey', '/api/passkey']) {
    try {
      const response = await fetch(`${base}${path}/login/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok && response.status !== 401) continue;

      const options = (await response.json()) as { challenge?: string; rpId?: string };
      if (!options.challenge) continue;

      pass(`${path}/login/start responded with options`);

      if (response.headers.get('cache-control')?.includes('no-store')) {
        pass('challenge responses are not cacheable');
      } else {
        fail(
          'the challenge response is missing cache-control: no-store',
          'A cached challenge is a replayable one. A CDN in front of your app can strip it.',
          'Check whatever sits in front of your server.',
        );
      }

      const host = new URL(base).hostname;
      if (options.rpId && host !== options.rpId && !host.endsWith(`.${options.rpId}`)) {
        fail(
          `the server returned rpId "${options.rpId}" but this URL is "${host}"`,
          'Every ceremony from this origin will fail.',
          `Set rpID to "${host}" or a registrable parent of it.`,
        );
      } else if (options.rpId) {
        pass(`rpId "${options.rpId}" matches ${host}`);
      }

      // Two calls must not produce the same challenge.
      const second = await fetch(`${base}${path}/login/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const other = (await second.json()) as { challenge?: string };
      if (other.challenge === options.challenge) {
        fail(
          'two requests returned the same challenge',
          'Challenges must be unpredictable and single-use. A repeated one is replayable.',
        );
      } else {
        pass('challenges differ between requests');
      }
      return;
    } catch {
      // Try the next mount point.
    }
  }
  warn(
    `could not find passkify routes under ${base}`,
    'Tried /passkey and /api/passkey.',
    'Is the server running, and mounted at one of those paths?',
  );
}
