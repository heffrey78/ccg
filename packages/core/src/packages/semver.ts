/**
 * Minimal semver range matching for package manifests (#25): exact versions,
 * `^`, `~`, comparison operators (`>=`, `>`, `<=`, `<`, `=`), `*`, ranges
 * joined by spaces (all must hold) and alternatives joined by `||`.
 * Pre-release tags are compared as plain strings after the version numbers.
 */

type Version = [number, number, number, string];

export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ''] : null;
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  // A release sorts after its pre-releases.
  if (a[3] === b[3]) return 0;
  if (a[3] === '') return 1;
  if (b[3] === '') return -1;
  return a[3] < b[3] ? -1 : 1;
}

/** Whether `version` satisfies `range`. Malformed input never satisfies. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split('||').some((alternative) => {
    const parts = alternative.trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every((part) => matches(v, part));
  });
}

function matches(v: Version, part: string): boolean {
  if (part === '*' || part === 'x') return true;
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(part);
  if (!m) return false;
  const op = m[1] ?? '=';
  const target = parseVersion(m[2] as string);
  if (!target) return false;
  const c = compare(v, target);
  switch (op) {
    case '=':
      return c === 0;
    case '>':
      return c > 0;
    case '>=':
      return c >= 0;
    case '<':
      return c < 0;
    case '<=':
      return c <= 0;
    case '~':
      return c >= 0 && v[0] === target[0] && v[1] === target[1];
    case '^': {
      if (c < 0) return false;
      // ^1.2.3 := <2.0.0, ^0.2.3 := <0.3.0, ^0.0.3 := <0.0.4
      if (target[0] > 0) return v[0] === target[0];
      if (target[1] > 0) return v[0] === 0 && v[1] === target[1];
      return v[0] === 0 && v[1] === 0 && v[2] === target[2];
    }
  }
  return false;
}
