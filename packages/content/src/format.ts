/**
 * The on-disk text form of content files (#34): JSON, 2-space indent, trailing
 * newline, and a fixed key order so that saving the same data always produces
 * the same bytes and diffs stay minimal.
 */

/** Current version of the content format. Bump it with a migration. */
export const FORMAT_VERSION = 1;

/** Keys written first, in this order, wherever they appear; the rest follow alphabetically. */
const LEADING_KEYS = ['formatVersion', 'kind', 'id', 'name', 'op'];

export function serialize(value: unknown): string {
  return `${JSON.stringify(ordered(value), null, 2)}\n`;
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined);
  const leading = LEADING_KEYS.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !LEADING_KEYS.includes(k)).sort();
  const out: Record<string, unknown> = {};
  for (const key of [...leading, ...rest]) out[key] = ordered(record[key]);
  return out;
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; message: string };

export function parseJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: `invalid JSON: ${(error as Error).message}` };
  }
}
