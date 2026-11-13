/**
 * The card table's lane: a root that winds across the table, one stepping stone per cell, drawn with
 * depth so that the near end is large and the far end small. Pure, so it is unit tested without a DOM.
 */
import type { Layout } from './world.js';

/** Where a cell's stone sits: the point a card stands on, and how large things there are drawn. */
export interface TableSpot {
  x: number;
  y: number;
  s: number;
}

export interface TableGeometry {
  portrait: boolean;
  /** A card standing at the near end. */
  card: { w: number; h: number };
  spots: TableSpot[];
  /** The root's SVG path between two spots. */
  path(from: number, to: number): string;
}

/** A unit card's proportions, as designed: every other size on the table follows from its width. */
export const CARD = { w: 104, h: 140 };

// The root's bends, in the box the stones fill: x across, y down, the near end first.
const PORTRAIT: [number, number][] = [[0, 1], [0.4, 0.94], [0.79, 0.85], [1, 0.63], [0.71, 0.46], [0.32, 0.38], [0, 0.25], [0.24, 0.08], [0.62, 0]];
const LANDSCAPE: [number, number][] = [[0, 1], [0.15, 0.97], [0.3, 0.84], [0.42, 0.56], [0.55, 0.35], [0.68, 0.32], [0.81, 0.26], [0.92, 0.13], [1, 0]];

/** A point on the Catmull-Rom curve through `pts`, `t` of the way along segment `i`. */
function along(pts: [number, number][], i: number, t: number): [number, number] {
  const p = (k: number) => pts[Math.max(0, Math.min(pts.length - 1, k))] as [number, number];
  const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** `n` points spaced evenly along the curve through `pts`. */
function spaced(pts: [number, number][], n: number): [number, number][] {
  const fine: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 24; k++) fine.push(along(pts, i, k / 24));
  fine.push(pts[pts.length - 1] as [number, number]);
  const lengths = [0];
  for (let i = 1; i < fine.length; i++) lengths.push((lengths[i - 1] as number) + Math.hypot((fine[i] as [number, number])[0] - (fine[i - 1] as [number, number])[0], (fine[i] as [number, number])[1] - (fine[i - 1] as [number, number])[1]));
  const total = lengths[lengths.length - 1] as number;
  return Array.from({ length: n }, (_, i) => {
    const want = n === 1 ? total / 2 : (total * i) / (n - 1);
    let k = lengths.findIndex((l) => l >= want);
    if (k < 1) k = 1;
    const [a, b] = [lengths[k - 1] as number, lengths[k] as number];
    const t = b > a ? (want - a) / (b - a) : 0;
    const [p, q] = [fine[k - 1] as [number, number], fine[k] as [number, number]];
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  });
}

/** Whether a layout is a single line of cells, which is what the table can draw. */
export function isLine(layout: Layout): boolean {
  const first = layout.cells[0];
  if (!first || layout.cells.length < 2) return false;
  return layout.cells.every((c) => Math.abs(c.y - first.y) < 0.01) || layout.cells.every((c) => Math.abs(c.x - first.x) < 0.01);
}

/** The cells of a line in order along it. */
export function lineOrder(layout: Layout): string[] {
  return [...layout.cells].sort((a, b) => a.x - b.x || a.y - b.y).map((c) => c.pos);
}

/** The lane for `n` cells in a box `width` by `height`: upright boxes wind up the table, wide ones across it. */
export function tableGeometry(n: number, width: number, height: number): TableGeometry {
  const portrait = height > width * 1.05;
  const far = portrait ? 0.61 : 0.75;
  const w = Math.max(40, portrait ? Math.min(width * 0.267, height * 0.24) : Math.min(height * 0.315, width * 0.115));
  const h = (w * CARD.h) / CARD.w;
  // The stones fill what is left once a card can stand on any of them without leaving the box.
  const box = portrait
    ? { left: w / 2 + 6, right: width - w * 0.45 - 12, top: h * far + 36, bottom: height - 18 }
    : { left: w / 2 + 6, right: width - (w * far) / 2 - 16, top: h * far + 34, bottom: height - 18 };
  const spots = spaced(portrait ? PORTRAIT : LANDSCAPE, n).map(([u, v], i) => ({
    x: box.left + (box.right - box.left) * u,
    y: box.top + (box.bottom - box.top) * v,
    s: 1 - (1 - far) * (n === 1 ? 0 : i / (n - 1)),
  }));
  const path = (from: number, to: number) => {
    const [a, b] = [Math.max(0, Math.min(from, to)), Math.min(n - 1, Math.max(from, to))];
    const at = (k: number) => spots[Math.max(0, Math.min(n - 1, k))] as TableSpot;
    let d = `M${at(a).x.toFixed(1)} ${at(a).y.toFixed(1)}`;
    for (let i = a; i < b; i++) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };
  return { portrait, card: { w, h }, spots, path };
}
