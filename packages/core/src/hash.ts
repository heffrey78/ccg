/**
 * Stable hashing of plain-data game state, used to check that replays
 * reproduce identical state (#20) and to compare snapshots cheaply.
 *
 * Values are serialized canonically (object keys sorted) before hashing, so
 * key insertion order never affects the result. Anything that isn't plain data
 * throws, which also catches state that has picked up class instances,
 * functions or non-finite numbers.
 */

/** Canonical JSON for plain data: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

/** 64-bit hash of the canonical form, as 16 hex characters. */
export function hashState(value: unknown): string {
  return hash64(canonicalJson(value));
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite number ${value}`);
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`${path}: ${typeof value} is not plain data`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, i) => serialize(item, `${path}[${i}]`)).join(',')}]`;
  }

  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${path}: ${describe(value)} is not plain data`);
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    // Matches JSON: absent and undefined properties are the same thing.
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${serialize(item, `${path}.${key}`)}`);
  }
  return `{${parts.join(',')}}`;
}

function describe(value: object): string {
  const name = value.constructor?.name;
  return name ? `${name} instance` : 'object with a custom prototype';
}

/** Two independent 32-bit FNV-1a-style lanes over UTF-16 code units. */
function hash64(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 15);
  }
  // Final avalanche so short inputs still spread across all bits.
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
  h1 = Math.imul(h1 ^ (h1 >>> 13), 0xc2b2ae35);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 0x85ebca6b);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  h2 ^= h2 >>> 16;
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
