/**
 * Variable references in effect parameters (§3.1). A parameter written as
 * `{ $: 'event.position' }` is replaced by that variable's value when the
 * effect starts. Nested effects (objects with an `op`) are left alone: their
 * references resolve when they run. Everything else passes through unchanged.
 */

export class ContentError extends Error {
  override name = 'ContentError';
}

export function isVarRef(value: unknown): value is { $: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { $?: unknown }).$ === 'string'
  );
}

export function resolveParams(
  params: Record<string, unknown>,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  return resolveValue(params, vars) as Record<string, unknown>;
}

function resolveValue(value: unknown, vars: Record<string, unknown>): unknown {
  if (isVarRef(value)) return lookup(value.$, vars);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, vars));
  if (typeof value === 'object' && value !== null) {
    if (typeof (value as { op?: unknown }).op === 'string') return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, vars);
    return out;
  }
  return value;
}

function lookup(path: string, vars: Record<string, unknown>): unknown {
  let current: unknown = vars;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      throw new ContentError(`unknown variable '${path}'`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
