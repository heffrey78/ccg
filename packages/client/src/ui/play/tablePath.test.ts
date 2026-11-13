import { describe, expect, it } from 'vitest';
import { CARD, isLine, lineOrder, tableGeometry } from './tablePath.js';
import type { Layout } from './world.js';

const lane = (n: number): Layout => ({ kind: 'lane', cell: 'square', cells: Array.from({ length: n }, (_, i) => ({ pos: String(i), x: i, y: 0 })), directions: {}, tiles: {} }) as unknown as Layout;

describe('the card table lane', () => {
  it.each([
    ['a phone held upright', 412, 600],
    ['a phone on its side', 915, 320],
  ])('on %s, every card stands inside the box, and the far end is smaller', (_name, width, height) => {
    const g = tableGeometry(9, width, height);
    expect(g.spots).toHaveLength(9);
    for (const p of g.spots) {
      const [w, h] = [g.card.w * p.s, g.card.h * p.s];
      expect(p.x - w / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + w / 2).toBeLessThanOrEqual(width);
      expect(p.y - h).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
    }
    expect(g.spots[0]?.s).toBe(1);
    expect(g.spots[8]?.s).toBeLessThan(0.8);
    expect(g.card.h / g.card.w).toBeCloseTo(CARD.h / CARD.w);
  });

  it('spaces the stones evenly along the root, so a step is a step', () => {
    const g = tableGeometry(9, 412, 600);
    const steps = g.spots.slice(1).map((p, i) => Math.hypot(p.x - (g.spots[i]?.x ?? 0), p.y - (g.spots[i]?.y ?? 0)));
    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(1.5);
  });

  it('winds up an upright table and runs across a wide one', () => {
    expect(tableGeometry(9, 412, 600).portrait).toBe(true);
    const wide = tableGeometry(9, 915, 320);
    expect(wide.portrait).toBe(false);
    expect(wide.spots.every((p, i) => i === 0 || p.x > (wide.spots[i - 1]?.x ?? 0))).toBe(true);
  });

  it('fits lanes of other lengths, and draws the root between any two stones', () => {
    for (const n of [2, 5, 12]) expect(tableGeometry(n, 412, 600).spots).toHaveLength(n);
    const g = tableGeometry(9, 412, 600);
    expect(g.path(0, 3)).toMatch(/^M[\d.]+ [\d.]+( C[\d. -]+){3}$/);
    expect(g.path(3, 0)).toBe(g.path(0, 3));
  });

  it('knows a line from a grid, and orders its cells', () => {
    expect(isLine(lane(9))).toBe(true);
    const grid = { ...lane(4), cells: [{ pos: 'a', x: 0, y: 0 }, { pos: 'b', x: 1, y: 0 }, { pos: 'c', x: 0, y: 1 }, { pos: 'd', x: 1, y: 1 }] } as unknown as Layout;
    expect(isLine(grid)).toBe(false);
    expect(lineOrder({ ...lane(3), cells: [{ pos: 'c', x: 2, y: 0 }, { pos: 'a', x: 0, y: 0 }, { pos: 'b', x: 1, y: 0 }] } as unknown as Layout)).toEqual(['a', 'b', 'c']);
  });
});
