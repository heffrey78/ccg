import { describe, expect, it } from 'vitest';
import { canonicalJson, hashState } from './hash.js';

describe('canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 0, y: 1 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[1,{"y":1,"z":0}]},"b":1}',
    );
  });

  it('drops undefined properties like JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('accepts null-prototype objects', () => {
    const bare = Object.assign(Object.create(null) as object, { a: 1 });
    expect(canonicalJson(bare)).toBe('{"a":1}');
  });

  it.each([
    ['a Map', new Map()],
    ['a class instance', new (class Unit {})()],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a function', () => 0],
    ['a bigint', 1n],
    ['undefined inside an array', undefined],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalJson({ nested: [value] })).toThrow(TypeError);
  });

  it('names the offending path', () => {
    expect(() => canonicalJson({ units: [{ hp: Number.NaN }] })).toThrow('$.units[0].hp');
  });
});

describe('hashState', () => {
  it('is pinned for known inputs', () => {
    expect(hashState({ b: 1, a: [1, 'x', null, true] })).toBe('95adb45e720b6a10');
    expect(hashState({})).toBe('3ff9b36ca39aea4d');
  });

  it('ignores key order and is 16 hex characters', () => {
    const a = hashState({ x: 1, y: [2, 3] });
    expect(a).toBe(hashState({ y: [2, 3], x: 1 }));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when any value changes', () => {
    const base = { units: [{ id: 'u1', hp: 10 }], turn: 3 };
    const seen = new Set([
      hashState(base),
      hashState({ ...base, turn: 4 }),
      hashState({ ...base, units: [{ id: 'u1', hp: 9 }] }),
      hashState({ ...base, units: [{ id: 'u2', hp: 10 }] }),
      hashState({ ...base, units: [] }),
    ]);
    expect(seen.size).toBe(5);
  });
});
