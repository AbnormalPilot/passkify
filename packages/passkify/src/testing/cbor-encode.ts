/**
 * A minimal CBOR *encoder*, written only for tests.
 *
 * Deliberately a separate implementation from `src/server/crypto/cbor.ts`,
 * which only decodes: if the same code produced and consumed the fixtures, a
 * mistake in one would be invisible because it would cancel out in the other.
 * This encoder follows CTAP2 canonical form (definite lengths, sorted map keys).
 */

function head(major: number, argument: number): Uint8Array {
  if (argument < 24) {
    return new Uint8Array([(major << 5) | argument]);
  }
  if (argument < 0x100) {
    return new Uint8Array([(major << 5) | 24, argument]);
  }
  if (argument < 0x10000) {
    return new Uint8Array([(major << 5) | 25, argument >> 8, argument & 0xff]);
  }
  if (argument < 0x100000000) {
    return new Uint8Array([
      (major << 5) | 26,
      (argument >>> 24) & 0xff,
      (argument >>> 16) & 0xff,
      (argument >>> 8) & 0xff,
      argument & 0xff,
    ]);
  }
  throw new Error('encoder does not handle 64-bit arguments');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export type Encodable =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | Encodable[]
  | Map<string | number, Encodable>;

export function encodeCBOR(value: Encodable): Uint8Array {
  if (value === null) {
    return new Uint8Array([0xf6]);
  }
  if (value === true) {
    return new Uint8Array([0xf5]);
  }
  if (value === false) {
    return new Uint8Array([0xf4]);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('encoder handles integers only');
    }
    return value >= 0 ? head(0, value) : head(1, -value - 1);
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) {
    return concat([head(2, value.length), value]);
  }
  if (Array.isArray(value)) {
    return concat([head(4, value.length), ...value.map(encodeCBOR)]);
  }
  if (value instanceof Map) {
    // Canonical ordering: shorter encoded keys first, then bytewise.
    const entries = [...value.entries()]
      .map(([key, item]) => ({ key: encodeCBOR(key), item: encodeCBOR(item) }))
      .sort((a, b) => {
        if (a.key.length !== b.key.length) {
          return a.key.length - b.key.length;
        }
        for (let i = 0; i < a.key.length; i++) {
          if (a.key[i] !== b.key[i]) {
            return a.key[i] - b.key[i];
          }
        }
        return 0;
      });
    return concat([head(5, entries.length), ...entries.flatMap((e) => [e.key, e.item])]);
  }
  throw new Error(`encoder cannot handle ${typeof value}`);
}

/** Parse a hex string into bytes — for spec test vectors. */
export function hex(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
