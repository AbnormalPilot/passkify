/**
 * A full ceremony, on a runtime that is not Node.
 *
 * Deliberately plain JavaScript with no test framework: Bun and Deno each have
 * their own, and the point is to prove the *library* runs, not that a runner
 * does. It imports the built ESM output — what a user actually installs.
 *
 * One caveat worth stating precisely: the virtual authenticator generates keys
 * with node:crypto, so this script needs a runtime whose Node compatibility
 * covers `KeyObject.export({ format: 'jwk' })`. Bun does; Deno does not, for EC
 * keys. That is a limit of the *test double*, not of passkify — the library
 * imports no Node built-in at all, which `runtime-neutral.test.ts` enforces
 * separately and unconditionally.
 */

import { PasskeyServer, MemoryStore } from '../../dist/esm/server/index.js';
import { VirtualAuthenticator } from '../../dist/esm/testing/index.js';

const RP_ID = 'example.com';
const ORIGIN = 'https://example.com';

const runtime = typeof Bun !== 'undefined' ? 'Bun' : typeof Deno !== 'undefined' ? 'Deno' : 'Node';

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL (${runtime}): ${message}`);
    if (typeof process !== 'undefined') process.exit(1);
    throw new Error(message);
  }
}

const passkeys = new PasskeyServer({
  rpName: 'Smoke',
  rpID: RP_ID,
  origin: ORIGIN,
  store: new MemoryStore(),
});

const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

const registration = await passkeys.startRegistration({ username: 'ada' });
const created = await passkeys.finishRegistration(
  authenticator.create({ challenge: registration.options.challenge, origin: ORIGIN }),
);
assert(created.verified === true, 'registration did not verify');

const login = await passkeys.startAuthentication({ username: 'ada' });
const verified = await passkeys.finishAuthentication(
  authenticator.assert({
    challenge: login.options.challenge,
    origin: ORIGIN,
    userHandle: registration.userId,
  }),
);
assert(verified.verified === true, 'authentication did not verify');
assert(verified.user.username === 'ada', 'the wrong account was returned');

// And a tampered response must still be refused, or the checks are not running.
const tampered = await passkeys.startAuthentication({ username: 'ada' });
let refused = false;
try {
  await passkeys.finishAuthentication(
    authenticator.assert({
      challenge: tampered.options.challenge,
      origin: ORIGIN,
      tamper: { origin: 'https://evil.example' },
    }),
  );
} catch (error) {
  refused = error.code === 'origin_mismatch';
}
assert(refused, 'a response signed for the wrong origin was accepted');

console.log(`${runtime}: register, login and a rejected tampered login all behaved.`);
