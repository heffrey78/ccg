/**
 * Version of the engine API that game packages, saves and replays declare
 * compatibility with (see decision #14). Bumped independently of the npm
 * package version.
 */
export const ENGINE_API_VERSION = '0.0.0';

/**
 * Whether data written against `saved` can be read by an engine at `current`.
 * Same major version, not newer; while the major is 0, the minor must match.
 */
export function isEngineCompatible(saved: string, current: string = ENGINE_API_VERSION): boolean {
  const a = parseVersion(saved);
  const b = parseVersion(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return false;
  if (a[0] === 0 && a[1] !== b[1]) return false;
  return a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]);
}

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
