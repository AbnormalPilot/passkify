/**
 * base64url helpers.
 *
 * Implemented by hand over `Uint8Array` so the exact same code runs in the
 * browser, Node, Deno, Bun and edge runtimes with no `Buffer`, `atob` or
 * `btoa` dependency (and no surprises with `atob` on binary data).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Reverse lookup table. Accepts both base64url (`-_`) and standard (`+/`). */
const LOOKUP = /* @__PURE__ */ (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  table['+'.charCodeAt(0)] = 62;
  table['/'.charCodeAt(0)] = 63;
  return table;
})();

/** Encode bytes as an unpadded base64url string. */
export function toBase64Url(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let out = '';

  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      ALPHABET[n & 63];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }

  return out;
}

/**
 * Decode a base64url (or base64) string into bytes.
 *
 * Padding is optional and whitespace is rejected, matching what authenticators
 * and browsers actually produce.
 */
export function fromBase64Url(input: string): Uint8Array {
  let end = input.length;
  while (end > 0 && input[end - 1] === '=') {
    end--;
  }

  const groups = end >> 2;
  const rest = end - groups * 4;
  if (rest === 1) {
    throw new TypeError('Invalid base64url string: unexpected length');
  }

  const outLength = groups * 3 + (rest === 2 ? 1 : rest === 3 ? 2 : 0);
  const out = new Uint8Array(outLength);

  let o = 0;
  const sextet = (index: number): number => {
    const value = LOOKUP[input.charCodeAt(index)];
    if (value === undefined || value < 0) {
      throw new TypeError(`Invalid base64url string: bad character at index ${index}`);
    }
    return value;
  };

  let i = 0;
  for (; i + 3 < end; i += 4) {
    const n = (sextet(i) << 18) | (sextet(i + 1) << 12) | (sextet(i + 2) << 6) | sextet(i + 3);
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }

  if (rest === 2) {
    out[o++] = ((sextet(i) << 2) | (sextet(i + 1) >> 4)) & 255;
  } else if (rest === 3) {
    const n = (sextet(i) << 10) | (sextet(i + 1) << 4) | (sextet(i + 2) >> 2);
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }

  return out;
}

/** UTF-8 encode a string. */
export function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** UTF-8 decode bytes, throwing on malformed input. */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Constant-time byte comparison. Length differences leak, contents do not. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** Concatenate byte arrays into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
