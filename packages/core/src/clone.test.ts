import { describe, expect, it } from 'vitest';
import { clonePlain } from './clone.js';

describe('clonePlain', () => {
  it('deep-copies nested objects and arrays', () => {
    const original = { a: [1, { b: 'x' }], c: { d: null, e: true } };
    const copy = clonePlain(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.a[1]).not.toBe(original.a[1]);
    (copy.c as { e: boolean }).e = false;
    expect(original.c.e).toBe(true);
  });

  it('returns primitives unchanged', () => {
    expect(clonePlain(3)).toBe(3);
    expect(clonePlain('s')).toBe('s');
    expect(clonePlain(null)).toBeNull();
  });
});
