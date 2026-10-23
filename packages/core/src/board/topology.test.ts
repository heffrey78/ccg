import { describe, expect, it } from 'vitest';
import { HexTopology } from './hex.js';
import { LaneTopology } from './lane.js';
import { SquareTopology } from './square.js';
import { findPath, lineOfSight, type Topology } from './topology.js';

const topologies: [string, Topology][] = [
  ['lane', new LaneTopology(7)],
  ['square4', new SquareTopology({ width: 5, height: 4 })],
  ['square8', new SquareTopology({ width: 5, height: 4, connectivity: 8 })],
  ['hex', HexTopology.hexagon(3)],
];

describe.each(topologies)('%s topology contract', (_name, topo) => {
  const positions = topo.positions();

  it('lists unique positions in board order', () => {
    expect(new Set(positions).size).toBe(positions.length);
    expect([...positions].sort((a, b) => topo.compare(a, b))).toEqual(positions);
    for (const p of positions) expect(topo.contains(p)).toBe(true);
  });

  it('has an even number of directions, and rotation and opposites are consistent', () => {
    const dirs = topo.directions();
    expect(dirs.length % 2).toBe(0);
    for (const d of dirs) {
      expect(topo.rotate(d, dirs.length)).toBe(d);
      expect(topo.rotate(d, -1)).toBe(topo.rotate(d, dirs.length - 1));
      expect(topo.opposite(topo.opposite(d))).toBe(d);
    }
  });

  it('steps reverse with the opposite direction and land at distance 1', () => {
    for (const p of positions) {
      for (const d of topo.directions()) {
        const next = topo.step(p, d);
        if (next === null) continue;
        expect(topo.distance(p, next)).toBe(1);
        expect(topo.step(next, topo.opposite(d))).toBe(p);
        expect(topo.directionTo(p, next)).toBe(d);
      }
    }
  });

  it('neighbours are exactly the positions at distance 1', () => {
    for (const p of positions) {
      const atOne = positions.filter((q) => topo.distance(p, q) === 1);
      expect([...topo.neighbors(p)].sort()).toEqual([...atOne].sort());
    }
  });

  it('distance is a metric', () => {
    for (const a of positions) {
      expect(topo.distance(a, a)).toBe(0);
      for (const b of positions) {
        expect(topo.distance(a, b)).toBe(topo.distance(b, a));
        if (a !== b) expect(topo.distance(a, b)).toBeGreaterThan(0);
      }
    }
    for (let i = 0; i < positions.length; i += 3) {
      for (let j = 1; j < positions.length; j += 4) {
        for (let k = 2; k < positions.length; k += 5) {
          const [a, b, c] = [positions[i], positions[j], positions[k]] as [string, string, string];
          expect(topo.distance(a, c)).toBeLessThanOrEqual(topo.distance(a, b) + topo.distance(b, c));
        }
      }
    }
  });

  it('lines run end to end through neighbours with one cell per unit of distance', () => {
    for (const a of positions) {
      for (const b of positions) {
        const line = topo.line(a, b);
        expect(line[0]).toBe(a);
        expect(line.at(-1)).toBe(b);
        expect(line).toHaveLength(topo.distance(a, b) + 1);
        for (let i = 1; i < line.length; i++) {
          expect(topo.distance(line[i - 1] as string, line[i] as string)).toBe(1);
        }
      }
    }
  });

  it('ring and area patterns match distances', () => {
    const origin = positions[Math.floor(positions.length / 2)] as string;
    const facing = topo.directions()[0] as string;
    for (const radius of [1, 2]) {
      expect(topo.pattern(origin, facing, { kind: 'ring', radius })).toEqual(
        positions.filter((p) => topo.distance(origin, p) === radius),
      );
      expect(topo.pattern(origin, facing, { kind: 'area', radius, includeOrigin: true })).toEqual(
        positions.filter((p) => topo.distance(origin, p) <= radius),
      );
    }
    expect(topo.pattern(origin, facing, { kind: 'adjacent' })).toEqual(
      topo.pattern(origin, facing, { kind: 'ring', radius: 1 }),
    );
  });

  it('a path on an empty board is as long as the distance', () => {
    const a = positions[0] as string;
    const b = positions.at(-1) as string;
    expect(findPath(topo, a, b, () => true)).toHaveLength(topo.distance(a, b) + 1);
  });

  it('rejects unknown positions and directions', () => {
    expect(() => topo.step('nope', topo.directions()[0] as string)).toThrow(RangeError);
    expect(() => topo.step(positions[0] as string, 'up')).toThrow(RangeError);
  });
});

describe('patterns (golden)', () => {
  it('lane: line stops at the edge, cone is a line', () => {
    const lane = new LaneTopology(5);
    expect(lane.pattern('3', 'e', { kind: 'line', length: 3 })).toEqual(['4']);
    expect(lane.pattern('1', 'w', { kind: 'cone', length: 2 })).toEqual(['0']);
    expect(lane.pattern('2', 'e', { kind: 'offsets', offsets: [[0], [1], [0, 0]] })).toEqual(['1', '3', '4']);
  });

  it('square: cones grow 1, 3, 5 cells per row and turn with facing', () => {
    const sq = new SquareTopology({ width: 7, height: 7 });
    expect(sq.pattern('3,3', 'e', { kind: 'cone', length: 2 })).toEqual(['5,2', '4,3', '5,3', '5,4']);
    expect(sq.pattern('3,3', 'n', { kind: 'cone', length: 2 })).toEqual(['2,1', '3,1', '4,1', '3,2']);
    expect(sq.pattern('3,3', 's', { kind: 'line', length: 2 })).toEqual(['3,4', '3,5']);
  });

  it('square8: diagonal cone is a quadrant', () => {
    const sq = new SquareTopology({ width: 7, height: 7, connectivity: 8 });
    expect(sq.pattern('3,3', 'se', { kind: 'cone', length: 1 })).toEqual(['4,3', '3,4', '4,4']);
  });

  it('square: offsets are relative to facing (forward-forward, forward-right)', () => {
    const sq = new SquareTopology({ width: 7, height: 7 });
    const shape = { kind: 'offsets' as const, offsets: [[0, 0], [0, 1]] };
    expect(sq.pattern('3,3', 'n', shape)).toEqual(['3,1', '4,2']);
    expect(sq.pattern('3,3', 'e', shape)).toEqual(['5,3', '4,4']);
  });

  it('hex: adjacent cells and a 120° cone', () => {
    const hex = HexTopology.hexagon(3);
    expect(hex.pattern('0,0', 'e', { kind: 'adjacent' })).toEqual(['0,-1', '1,-1', '-1,0', '1,0', '-1,1', '0,1']);
    expect(hex.pattern('0,0', 'e', { kind: 'cone', length: 1 })).toEqual(['1,-1', '1,0', '0,1']);
    expect(hex.pattern('0,0', 'e', { kind: 'cone', length: 2 })).toHaveLength(3 + 5);
  });

  it('hex maps can be irregular', () => {
    const hex = new HexTopology([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(hex.neighbors('1,0')).toEqual(['2,0', '0,0']);
    expect(hex.step('2,0', 'e')).toBeNull();
  });
});

describe('lineOfSight', () => {
  it('is blocked only by cells strictly between the ends', () => {
    const sq = new SquareTopology({ width: 5, height: 5, connectivity: 8 });
    const walls = new Set(['2,2']);
    expect(lineOfSight(sq, '0,0', '4,4', (p) => walls.has(p))).toBe(false);
    expect(lineOfSight(sq, '0,0', '2,2', (p) => walls.has(p))).toBe(true);
    expect(lineOfSight(sq, '0,4', '4,4', (p) => walls.has(p))).toBe(true);
  });
});

describe('findPath', () => {
  const sq = new SquareTopology({ width: 5, height: 5 });

  it('routes around blockers along a shortest path', () => {
    const walls = new Set(['1,0', '1,1', '1,2', '1,3']);
    const path = findPath(sq, '0,0', '2,0', (p) => !walls.has(p));
    expect(path?.[0]).toBe('0,0');
    expect(path?.at(-1)).toBe('2,0');
    expect(path).toHaveLength(11);
    expect(path?.some((p) => walls.has(p))).toBe(false);
  });

  it('returns null when the goal is unreachable or blocked', () => {
    const walls = new Set(['1,0', '1,1', '1,2', '1,3', '1,4']);
    expect(findPath(sq, '0,0', '4,4', (p) => !walls.has(p))).toBeNull();
    expect(findPath(sq, '0,0', '2,2', (p) => p !== '2,2')).toBeNull();
  });

  it('is deterministic and respects step costs', () => {
    const a = findPath(sq, '0,0', '4,4', () => true);
    expect(findPath(sq, '0,0', '4,4', () => true)).toEqual(a);
    // Make the bottom row expensive: the path should avoid it.
    const costly = findPath(sq, '0,4', '4,4', () => true, (_f, t) => (t.endsWith(',4') ? 10 : 1));
    expect(costly?.slice(1, -1).some((p) => p.endsWith(',4'))).toBe(false);
  });

  it('returns the start alone when from equals to', () => {
    expect(findPath(sq, '2,2', '2,2', () => false)).toEqual(['2,2']);
  });
});
