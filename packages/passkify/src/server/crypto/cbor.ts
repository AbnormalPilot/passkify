/**
 * A small, strict CBOR (RFC 8949) decoder covering exactly what WebAuthn needs:
 * attestation objects and COSE public keys.
 *
 * Why hand-rolled instead of a dependency: this parser sits directly on
 * attacker-controlled bytes, so it is worth being able to read all of it. It is
 * deliberately conservative —
 *
 *  - every length is checked against the remaining buffer before allocating,
 *  - nesting depth is bounded,
 *  - duplicate map keys are rejected (they are a classic parser-differential),
 *  - trailing bytes are rejected by `decode()`,
 *  - big integers surface as `bigint` rather than silently losing precision.
 *
 * Indefinite-length items are accepted even though CTAP2 canonical CBOR forbids
 * them, because a few real authenticators emit them and rejecting would lock
 * those users out for no security gain.
 */

import { PasskeyError } from '../../shared/errors.js';

export type CBORValue =
  | number
  | bigint
  | string
  | Uint8Array
  | boolean
  | null
  | undefined
  | CBORValue[]
  | CBORMap;

/** CBOR maps keep integer keys (COSE) and string keys (attestation) apart. */
export type CBORMap = Map<string | number | bigint, CBORValue>;

const MAX_DEPTH = 32;

const MAJOR_UNSIGNED = 0;
const MAJOR_NEGATIVE = 1;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_TAG = 6;
const MAJOR_SIMPLE = 7;

const BREAK = 0xff;

function fail(message: string): never {
  throw new PasskeyError('parse_error', `CBOR: ${message}`);
}

class Reader {
  readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  byte(): number {
    if (this.offset >= this.bytes.length) {
      fail('unexpected end of input');
    }
    return this.bytes[this.offset++];
  }

  peek(): number {
    if (this.offset >= this.bytes.length) {
      fail('unexpected end of input');
    }
    return this.bytes[this.offset];
  }

  take(length: number): Uint8Array {
    if (length > this.remaining) {
      fail(`declared length ${length} exceeds the ${this.remaining} bytes available`);
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  uint(size: 1 | 2 | 4 | 8): number | bigint {
    if (size === 1) {
      return this.byte();
    }
    if (size === 2) {
      return (this.byte() << 8) | this.byte();
    }
    if (size === 4) {
      // `>>> 0` keeps values above 2^31 positive.
      return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
    }
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      value = (value << 8n) | BigInt(this.byte());
    }
    // Stay in `number` while it is lossless; only escalate past 2^53-1.
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
}

/**
 * Read the argument of a CBOR head byte.
 * Returns `null` for the indefinite-length marker (additional info 31).
 */
function readArgument(reader: Reader, additionalInfo: number): number | bigint | null {
  if (additionalInfo < 24) {
    return additionalInfo;
  }
  switch (additionalInfo) {
    case 24:
      return reader.uint(1);
    case 25:
      return reader.uint(2);
    case 26:
      return reader.uint(4);
    case 27:
      return reader.uint(8);
    case 31:
      return null;
    default:
      return fail(`reserved additional information value ${additionalInfo}`);
  }
}

function asLength(value: number | bigint, what: string): number {
  if (typeof value === 'bigint' || value > Number.MAX_SAFE_INTEGER) {
    fail(`${what} length is absurdly large`);
  }
  return value;
}

function readFloat16(reader: Reader): number {
  const half = (reader.byte() << 8) | reader.byte();
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x03ff;

  if (exponent === 0) {
    return sign * 2 ** -24 * fraction;
  }
  if (exponent === 0x1f) {
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  }
  return sign * 2 ** (exponent - 25) * (fraction + 1024);
}

function readValue(reader: Reader, depth: number): CBORValue {
  if (depth > MAX_DEPTH) {
    fail(`nesting deeper than ${MAX_DEPTH} levels`);
  }

  const head = reader.byte();
  const major = head >> 5;
  const additionalInfo = head & 0x1f;

  switch (major) {
    case MAJOR_UNSIGNED: {
      const argument = readArgument(reader, additionalInfo);
      if (argument === null) {
        fail('indefinite length is not valid for an integer');
      }
      return argument;
    }

    case MAJOR_NEGATIVE: {
      const argument = readArgument(reader, additionalInfo);
      if (argument === null) {
        fail('indefinite length is not valid for an integer');
      }
      if (typeof argument === 'bigint') {
        return -1n - argument;
      }
      return -1 - argument;
    }

    case MAJOR_BYTES: {
      const argument = readArgument(reader, additionalInfo);
      if (argument === null) {
        return concatChunks(readChunks(reader, MAJOR_BYTES, depth) as Uint8Array[]);
      }
      // Copy: the result outlives the parse and callers should not alias input.
      return new Uint8Array(reader.take(asLength(argument, 'byte string')));
    }

    case MAJOR_TEXT: {
      const argument = readArgument(reader, additionalInfo);
      if (argument === null) {
        return (readChunks(reader, MAJOR_TEXT, depth) as string[]).join('');
      }
      const raw = reader.take(asLength(argument, 'text string'));
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(raw);
      } catch {
        return fail('text string is not valid UTF-8');
      }
    }

    case MAJOR_ARRAY: {
      const argument = readArgument(reader, additionalInfo);
      const items: CBORValue[] = [];
      if (argument === null) {
        while (reader.peek() !== BREAK) {
          items.push(readValue(reader, depth + 1));
        }
        reader.byte();
        return items;
      }
      const count = asLength(argument, 'array');
      // One byte is the floor for any encoded item, so a count larger than the
      // remaining buffer is a lie — reject before allocating.
      if (count > reader.remaining) {
        fail(`array of ${count} items cannot fit in ${reader.remaining} bytes`);
      }
      for (let i = 0; i < count; i++) {
        items.push(readValue(reader, depth + 1));
      }
      return items;
    }

    case MAJOR_MAP: {
      const argument = readArgument(reader, additionalInfo);
      const map: CBORMap = new Map();
      const readEntry = (): void => {
        const key = readValue(reader, depth + 1);
        if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'bigint') {
          fail('map keys must be integers or text strings');
        }
        if (map.has(key)) {
          fail(`duplicate map key ${String(key)}`);
        }
        map.set(key, readValue(reader, depth + 1));
      };

      if (argument === null) {
        while (reader.peek() !== BREAK) {
          readEntry();
        }
        reader.byte();
        return map;
      }
      const count = asLength(argument, 'map');
      if (count * 2 > reader.remaining) {
        fail(`map of ${count} pairs cannot fit in ${reader.remaining} bytes`);
      }
      for (let i = 0; i < count; i++) {
        readEntry();
      }
      return map;
    }

    case MAJOR_TAG: {
      // Tags carry no meaning for WebAuthn payloads; unwrap and keep going.
      if (readArgument(reader, additionalInfo) === null) {
        fail('indefinite length is not valid for a tag');
      }
      return readValue(reader, depth + 1);
    }

    case MAJOR_SIMPLE: {
      switch (additionalInfo) {
        case 20:
          return false;
        case 21:
          return true;
        case 22:
          return null;
        case 23:
          return undefined;
        case 25:
          return readFloat16(reader);
        case 26: {
          const view = new DataView(new Uint8Array(reader.take(4)).buffer);
          return view.getFloat32(0, false);
        }
        case 27: {
          const view = new DataView(new Uint8Array(reader.take(8)).buffer);
          return view.getFloat64(0, false);
        }
        case 31:
          return fail('unexpected break outside an indefinite-length item');
        default:
          return fail(`unsupported simple value ${additionalInfo}`);
      }
    }

    default:
      return fail(`unsupported major type ${major}`);
  }
}

/** Read the chunks of an indefinite-length byte or text string. */
function readChunks(
  reader: Reader,
  expectedMajor: number,
  depth: number,
): Array<Uint8Array | string> {
  const chunks: Array<Uint8Array | string> = [];
  while (reader.peek() !== BREAK) {
    if (reader.peek() >> 5 !== expectedMajor) {
      fail('indefinite-length string contains a chunk of the wrong type');
    }
    const chunk = readValue(reader, depth + 1);
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
      fail('indefinite-length string contains a non-string chunk');
    }
    chunks.push(chunk);
  }
  reader.byte();
  return chunks;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Decode the first CBOR item and report how many bytes it used.
 *
 * WebAuthn needs this: a COSE public key sits inside authenticator data with
 * optional extension data glued directly after it, and the only way to find the
 * boundary is to parse the key and see where it ended.
 */
export function decodeFirst(bytes: Uint8Array): { value: CBORValue; bytesRead: number } {
  const reader = new Reader(bytes);
  const value = readValue(reader, 0);
  return { value, bytesRead: reader.offset };
}

/** Decode exactly one CBOR item, rejecting trailing bytes. */
export function decode(bytes: Uint8Array): CBORValue {
  const { value, bytesRead } = decodeFirst(bytes);
  if (bytesRead !== bytes.length) {
    fail(`${bytes.length - bytesRead} unexpected trailing byte(s)`);
  }
  return value;
}

/** Decode one CBOR item that must be a map. */
export function decodeMap(bytes: Uint8Array): CBORMap {
  const value = decode(bytes);
  if (!(value instanceof Map)) {
    fail('expected a map at the top level');
  }
  return value;
}
