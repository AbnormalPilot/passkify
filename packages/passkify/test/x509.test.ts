/**
 * The certificate layer, against certificates generated here rather than
 * fixtures — so the tests say what the parser must handle, not what one vendor
 * happened to emit.
 */

import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { Certificate, chainIsTrusted } from '#internal/server/crypto/x509.js';

/**
 * Build a self-signed certificate with openssl, which is present on every CI
 * runner. Returns PEM.
 */
function selfSigned(options: {
  subject: string;
  days?: number;
  ca?: boolean;
  algorithm?: 'ec' | 'rsa';
}): { pem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'passkify-x509-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  const keygen =
    options.algorithm === 'rsa'
      ? ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', keyPath]
      : ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath];
  execFileSync('openssl', keygen, { stdio: 'pipe' });

  const args = [
    'req',
    '-new',
    '-x509',
    '-key',
    keyPath,
    '-out',
    certPath,
    '-days',
    String(options.days ?? 365),
    '-subj',
    options.subject,
    '-sha256',
  ];
  if (options.ca) args.push('-addext', 'basicConstraints=critical,CA:TRUE');
  execFileSync('openssl', args, { stdio: 'pipe' });

  return {
    pem: execFileSync('cat', [certPath], { encoding: 'utf8' }),
    keyPem: execFileSync('cat', [keyPath], { encoding: 'utf8' }),
    dir,
  };
}

test('parses the same fields node:crypto does, for an EC certificate', () => {
  const { pem, dir } = selfSigned({ subject: '/CN=passkify test/O=passkify' });
  try {
    const ours = Certificate.from(pem);
    const theirs = new X509Certificate(pem);

    assert.ok(ours.subject.includes('CN=passkify test'));
    assert.ok(ours.subject.includes('O=passkify'));
    assert.equal(ours.serialNumber, BigInt(`0x${theirs.serialNumber}`));
    assert.equal(ours.notBefore.toISOString(), new Date(theirs.validFrom).toISOString());
    assert.equal(ours.notAfter.toISOString(), new Date(theirs.validTo).toISOString());
    assert.equal(ours.publicKey.algorithm, 'EC');
    assert.equal(ours.publicKey.curve, 'P-256');
    // X.509 ties these two together: a certificate carrying extensions is v3,
    // one without them is v1. Which of the two comes out here is a property of
    // the openssl that built the fixture, not of the parser — OpenSSL 3.x adds
    // subject and authority key identifiers to a self-signed certificate by
    // default, LibreSSL does not — so assert the rule rather than whichever
    // habit the local build has.
    assert.equal(ours.version, ours.extensions.length > 0 ? 3 : 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses an RSA certificate', () => {
  const { pem, dir } = selfSigned({ subject: '/CN=rsa test', algorithm: 'rsa' });
  try {
    const certificate = Certificate.from(pem);
    assert.equal(certificate.publicKey.algorithm, 'RSA');
    assert.ok(certificate.subject.includes('CN=rsa test'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a self-signed certificate verifies against itself and is a valid chain root', async () => {
  const { pem, dir } = selfSigned({ subject: '/CN=root', ca: true });
  try {
    const root = Certificate.from(pem);
    assert.equal(await root.verifySignatureBy(root), true);
    assert.equal(root.basicConstraints.ca, true);
    // Extensions force v3.
    assert.equal(root.version, 3);
    assert.ok(root.extension('2.5.29.19')?.critical);
    assert.equal(await chainIsTrusted([root], [root]), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unrelated certificate does not verify, and is not trusted', async () => {
  const a = selfSigned({ subject: '/CN=one', ca: true });
  const b = selfSigned({ subject: '/CN=two', ca: true });
  try {
    const one = Certificate.from(a.pem);
    const two = Certificate.from(b.pem);

    assert.equal(await one.verifySignatureBy(two), false);
    assert.equal(one.isIssuedBy(two), false);
    assert.equal(await chainIsTrusted([one], [two]), false);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('a chain with no roots is never trusted', async () => {
  const { pem, dir } = selfSigned({ subject: '/CN=lonely', ca: true });
  try {
    assert.equal(await chainIsTrusted([Certificate.from(pem)], []), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an expired certificate is not valid, and breaks the chain', async () => {
  const { pem, dir } = selfSigned({ subject: '/CN=expired', ca: true, days: 1 });
  try {
    const certificate = Certificate.from(pem);
    const wayLater = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    assert.equal(certificate.isValidAt(new Date()), true);
    assert.equal(certificate.isValidAt(wayLater), false);
    assert.equal(await chainIsTrusted([certificate], [certificate], wayLater), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tampered certificate fails verification', async () => {
  const { pem, dir } = selfSigned({ subject: '/CN=tamper', ca: true });
  try {
    const original = Certificate.from(pem);
    const bytes = Uint8Array.from(original.der);
    // Flip a bit deep inside the signed region.
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;

    let tampered: Certificate;
    try {
      tampered = Certificate.parse(bytes);
    } catch {
      return; // Mangling the structure is also an acceptable outcome.
    }
    assert.equal(await tampered.verifySignatureBy(original), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('garbage is rejected as parse_error, never as a TypeError', () => {
  for (const bytes of [
    new Uint8Array(0),
    new Uint8Array([0x30]),
    new Uint8Array([0x30, 0x82, 0xff, 0xff]),
    new Uint8Array(64).fill(0xab),
  ]) {
    assert.throws(
      () => Certificate.parse(bytes),
      (error: { code?: string }) => error.code === 'parse_error',
      `bytes ${bytes.length}`,
    );
  }
});

test('PEM with or without headers, and raw DER, all parse to the same certificate', () => {
  const { pem, dir } = selfSigned({ subject: '/CN=formats' });
  try {
    const fromPem = Certificate.from(pem);
    const bare = pem
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .trim();
    assert.equal(Certificate.from(bare).subject, fromPem.subject);
    assert.equal(Certificate.from(fromPem.der).subject, fromPem.subject);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Issue a certificate signed by another, so a real chain can be built.
 *
 * `chainIsTrusted` walking more than one link is the part that matters for
 * attestation roots — a manufacturer's batch certificate is signed by an
 * intermediate, not by the root you pinned — and a single self-signed
 * certificate never exercises it.
 */
function issuedBy(
  issuer: { pem: string; keyPem: string; dir: string },
  options: { subject: string; ca?: boolean },
): { pem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'passkify-x509-'));
  const keyPath = join(dir, 'key.pem');
  const csrPath = join(dir, 'req.csr');
  const certPath = join(dir, 'cert.pem');
  const issuerCert = join(dir, 'issuer.pem');
  const issuerKey = join(dir, 'issuer-key.pem');
  const extPath = join(dir, 'ext.cnf');

  writeFileSync(issuerCert, issuer.pem);
  writeFileSync(issuerKey, issuer.keyPem);
  writeFileSync(extPath, `basicConstraints=critical,CA:${options.ca ? 'TRUE' : 'FALSE'}\n`);

  execFileSync(
    'openssl',
    ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath],
    {
      stdio: 'pipe',
    },
  );
  execFileSync(
    'openssl',
    ['req', '-new', '-key', keyPath, '-subj', options.subject, '-out', csrPath],
    { stdio: 'pipe' },
  );
  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      csrPath,
      '-CA',
      issuerCert,
      '-CAkey',
      issuerKey,
      '-CAcreateserial',
      '-days',
      '365',
      '-sha256',
      '-extfile',
      extPath,
      '-out',
      certPath,
    ],
    { stdio: 'pipe' },
  );

  return { pem: readFileSync(certPath, 'utf8'), keyPem: readFileSync(keyPath, 'utf8'), dir };
}

test('a leaf, an intermediate and a root validate as one chain', async () => {
  const root = selfSigned({ subject: '/CN=root', ca: true });
  const intermediate = issuedBy(root, { subject: '/CN=intermediate', ca: true });
  const leaf = issuedBy(intermediate, { subject: '/CN=leaf' });
  try {
    const chain = [Certificate.from(leaf.pem), Certificate.from(intermediate.pem)];
    const roots = [Certificate.from(root.pem)];

    assert.equal(await chainIsTrusted(chain, roots), true);
    // The leaf alone does not reach the root: the intermediate is load-bearing.
    assert.equal(await chainIsTrusted([chain[0]], roots), false);
    // And order matters — a chain is leaf-first, not root-first.
    assert.equal(await chainIsTrusted([...chain].reverse(), roots), false);
  } finally {
    for (const { dir } of [root, intermediate, leaf]) rmSync(dir, { recursive: true, force: true });
  }
});

test('an intermediate that is not a CA breaks the chain', async () => {
  const root = selfSigned({ subject: '/CN=root', ca: true });
  // Signed by the root, but CA:FALSE — so it must not be allowed to issue.
  const notACA = issuedBy(root, { subject: '/CN=not-a-ca' });
  const leaf = issuedBy(notACA, { subject: '/CN=leaf' });
  try {
    const trusted = await chainIsTrusted(
      [Certificate.from(leaf.pem), Certificate.from(notACA.pem)],
      [Certificate.from(root.pem)],
    );
    assert.equal(trusted, false);
  } finally {
    for (const { dir } of [root, notACA, leaf]) rmSync(dir, { recursive: true, force: true });
  }
});

test('a chain whose root is not among the supplied roots is not trusted', async () => {
  const root = selfSigned({ subject: '/CN=root', ca: true });
  const other = selfSigned({ subject: '/CN=someone else', ca: true });
  const leaf = issuedBy(root, { subject: '/CN=leaf' });
  try {
    assert.equal(
      await chainIsTrusted([Certificate.from(leaf.pem)], [Certificate.from(other.pem)]),
      false,
    );
  } finally {
    for (const { dir } of [root, other, leaf]) rmSync(dir, { recursive: true, force: true });
  }
});
