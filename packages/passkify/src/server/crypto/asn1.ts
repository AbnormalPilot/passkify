/**
 * A minimal DER reader.
 *
 * This exists because `node:crypto`'s `X509Certificate` cannot be used on
 * Cloudflare Workers, Deno Deploy or Vercel Edge — but that is not the only
 * reason, and not even the main one. The attestation formats passkify needs to
 * support are unimplementable through it regardless: `android-key` requires
 * reading the Keymaster extension at OID 1.3.6.1.4.1.11129.2.1.17, `tpm`
 * requires the TPMT_PUBLIC and TPMS_ATTEST structures, and `packed` requires
 * the AAGUID extension at 1.3.6.1.4.1.45724.1.1.4. `X509Certificate` exposes
 * none of them. A DER reader was going to be written either way, so there is
 * one, and it is used everywhere rather than on some runtimes only.
 *
 * Scope: enough of DER to walk a certificate. It is a reader, not a validator
 * of the whole X.690 grammar, and it refuses anything it does not understand
 * rather than guessing.
 */

import { PasskeyError } from '../../shared/errors.js';

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x30,
  SET: 0x31,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
} as const;

export interface Element {
  /** The identifier octet, e.g. 0x30 for SEQUENCE. */
  tag: number;
  /** True for constructed types, whose content is more elements. */
  constructed: boolean;
  /** Content bytes, excluding tag and length. */
  content: Uint8Array;
  /** The element including its header — needed when a signature covers it. */
  raw: Uint8Array;
  /** Offset just past this element in the parent buffer. */
  next: number;
}

function fail(message: string, cause?: unknown): never {
  throw new PasskeyError('parse_error', `DER: ${message}`, { cause });
}

/** Read the element at `offset`. */
export function readElement(bytes: Uint8Array, offset = 0): Element {
  if (offset + 2 > bytes.length) fail('truncated element header');

  const tag = bytes[offset];
  if ((tag & 0x1f) === 0x1f) fail('multi-byte tags are not supported');

  const first = bytes[offset + 1];
  let length: number;
  let contentStart: number;

  if ((first & 0x80) === 0) {
    length = first;
    contentStart = offset + 2;
  } else {
    const lengthBytes = first & 0x7f;
    if (lengthBytes === 0) fail('indefinite lengths are not valid DER');
    // 4 bytes is 4 GB; a certificate that needs more is not a certificate.
    if (lengthBytes > 4) fail('length field is implausibly long');
    if (offset + 2 + lengthBytes > bytes.length) fail('truncated length field');

    length = 0;
    for (let i = 0; i < lengthBytes; i++) length = length * 256 + bytes[offset + 2 + i];
    if (length < 0x80) fail('length should have used the short form');
    contentStart = offset + 2 + lengthBytes;
  }

  const contentEnd = contentStart + length;
  if (contentEnd > bytes.length) fail('element runs past the end of the buffer');

  return {
    tag,
    constructed: (tag & 0x20) !== 0,
    content: bytes.subarray(contentStart, contentEnd),
    raw: bytes.subarray(offset, contentEnd),
    next: contentEnd,
  };
}

/** Read the element at `offset` and require it to have the given tag. */
export function readTagged(bytes: Uint8Array, tag: number, offset = 0): Element {
  const element = readElement(bytes, offset);
  if (element.tag !== tag) {
    fail(`expected tag 0x${tag.toString(16)}, found 0x${element.tag.toString(16)}`);
  }
  return element;
}

/** Every direct child of a constructed element. */
export function readChildren(element: Element): Element[] {
  if (!element.constructed) fail('cannot read children of a primitive element');
  const children: Element[] = [];
  let offset = 0;
  while (offset < element.content.length) {
    const child = readElement(element.content, offset);
    children.push(child);
    offset = child.next;
  }
  return children;
}

/** Decode an OBJECT IDENTIFIER's content into dotted-decimal form. */
export function readOID(element: Element): string {
  if (element.tag !== TAG.OID) fail('not an OBJECT IDENTIFIER');
  const bytes = element.content;
  if (bytes.length === 0) fail('empty OBJECT IDENTIFIER');

  // Every arc is base-128 with a continuation bit. Arithmetic rather than
  // shifts: `<<` coerces to int32, which silently corrupts anything past 2^31.
  const subidentifiers: number[] = [];
  let value = 0;
  let started = false;

  for (const byte of bytes) {
    if (!started && byte === 0x80) fail('OBJECT IDENTIFIER arc has a leading zero byte');
    started = true;
    if (value > (Number.MAX_SAFE_INTEGER - 127) / 128) fail('OBJECT IDENTIFIER arc is too large');
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      subidentifiers.push(value);
      value = 0;
      started = false;
    }
  }
  if (started) fail('OBJECT IDENTIFIER ends mid-arc');
  if (subidentifiers.length === 0) fail('OBJECT IDENTIFIER has no arcs');

  // The first subidentifier packs two arcs: 40 * first + second, where the
  // first is capped at 2 — so `2.100` encodes as 80 + 100, not as 4.something.
  const [packed, ...rest] = subidentifiers;
  const first = packed < 80 ? Math.floor(packed / 40) : 2;
  const second = packed - first * 40;

  return [first, second, ...rest].join('.');
}

/** Decode a UTCTime or GeneralizedTime. */
export function readTime(element: Element): Date {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(element.content);

  let year: number;
  let rest: string;

  if (element.tag === TAG.UTC_TIME) {
    // YYMMDDHHMMSSZ, with the RFC 5280 pivot at 50.
    if (text.length < 11) fail('UTCTime is too short');
    const yy = Number.parseInt(text.slice(0, 2), 10);
    year = yy >= 50 ? 1900 + yy : 2000 + yy;
    rest = text.slice(2);
  } else if (element.tag === TAG.GENERALIZED_TIME) {
    if (text.length < 13) fail('GeneralizedTime is too short');
    year = Number.parseInt(text.slice(0, 4), 10);
    rest = text.slice(4);
  } else {
    fail('not a time value');
  }

  const month = Number.parseInt(rest.slice(0, 2), 10);
  const day = Number.parseInt(rest.slice(2, 4), 10);
  const hour = Number.parseInt(rest.slice(4, 6), 10);
  const minute = Number.parseInt(rest.slice(6, 8), 10);
  const second = rest.length >= 10 ? Number.parseInt(rest.slice(8, 10), 10) : 0;

  const time = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(time)) fail(`unparseable time "${text}"`);
  return new Date(time);
}

/**
 * The payload of a BIT STRING, which is prefixed by a count of unused trailing
 * bits. Certificates only ever use whole bytes here.
 */
export function readBitString(element: Element): Uint8Array {
  if (element.tag !== TAG.BIT_STRING) fail('not a BIT STRING');
  if (element.content.length === 0) fail('empty BIT STRING');
  if (element.content[0] !== 0) fail('BIT STRING is not a whole number of bytes');
  return element.content.subarray(1);
}

/** Read an INTEGER as a bigint. Certificates use these for serial numbers. */
export function readInteger(element: Element): bigint {
  if (element.tag !== TAG.INTEGER) fail('not an INTEGER');
  if (element.content.length === 0) fail('empty INTEGER');
  let value = 0n;
  for (const byte of element.content) value = (value << 8n) | BigInt(byte);
  // Two's complement for a negative value.
  if (element.content[0] & 0x80) value -= 1n << BigInt(8 * element.content.length);
  return value;
}
