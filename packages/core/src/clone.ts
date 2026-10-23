/**
 * Deep copy of plain data (objects, arrays, primitives). The core copies state
 * at the start of each action so rejected actions leave the caller's state
 * untouched; this avoids depending on a host's `structuredClone`.
 */
export function clonePlain<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => clonePlain(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = clonePlain(item);
  return out as T;
}
