import { describe, expect, it } from 'vitest';
import { parseJson, serialize } from './format.js';

describe('serialize', () => {
  it('writes leading keys first, the rest alphabetically, at every depth', () => {
    const text = serialize({ zeta: 1, name: 'N', id: 'x', kind: 'card', formatVersion: 1, effects: [{ amount: 2, op: 'damage' }] });
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['formatVersion', 'kind', 'id', 'name', 'effects', 'zeta']);
    expect(text).toContain('{\n      "op": "damage",\n      "amount": 2\n    }');
  });

  it('uses 2-space indent and a trailing newline, and drops undefined fields', () => {
    expect(serialize({ b: undefined, a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
  });

  it('is stable regardless of input key order', () => {
    expect(serialize({ a: 1, b: { d: 1, c: 2 } })).toBe(serialize({ b: { c: 2, d: 1 }, a: 1 }));
  });
});

describe('parseJson', () => {
  it('reports invalid JSON without throwing', () => {
    expect(parseJson('{"a":')).toMatchObject({ ok: false, message: expect.stringMatching(/^invalid JSON/) });
    expect(parseJson('[1]')).toEqual({ ok: true, value: [1] });
  });
});
