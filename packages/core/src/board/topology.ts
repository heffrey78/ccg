/**
 * Board topologies (decision #13). Positions are opaque, serializable string
 * keys, and directions are named strings in clockwise order. Effects, AI and
 * clients only use this interface, so one push card works on a lane, a square
 * grid or a hex map.
 */

/** A board position key, e.g. "3" (lane), "4,2" (square) or "1,-2" (hex). */
export type Pos = string;
/** A direction name, e.g. "e", "nw". */
export type Dir = string;

/** Area shapes used by targeting and effects, relative to an origin and facing. */
export type PatternShape =
  | { kind: 'self' }
  | { kind: 'adjacent' }
  | { kind: 'line'; length: number }
  | { kind: 'cone'; length: number }
  | { kind: 'ring'; radius: number }
  | { kind: 'area'; radius: number; includeOrigin?: boolean }
  /**
   * Explicit cells. Each offset is a path of steps, each step given as turns
   * from the facing direction (0 = forward, 1 = one direction clockwise...).
   */
  | { kind: 'offsets'; offsets: number[][] };

/**
 * Where a topology's cells sit on screen, for clients (#29). Coordinates are
 * in cell units: neighbouring cell centres are about 1 apart, y grows down.
 */
export interface TopologyLayout {
  kind: string;
  cell: 'square' | 'hex';
  cells: { pos: Pos; x: number; y: number }[];
  /** Offset from a cell's centre to its neighbour's in each direction. */
  directions: Record<Dir, { x: number; y: number }>;
}

export interface Topology {
  readonly kind: string;
  /** Screen layout; topologies without one need a custom board renderer. */
  layout?(): TopologyLayout;
  /** All positions in canonical board order (resolution-order §3.2). */
  positions(): readonly Pos[];
  contains(pos: Pos): boolean;
  /** Board-order comparator. */
  compare(a: Pos, b: Pos): number;
  /** Directions in clockwise order. */
  directions(): readonly Dir[];
  /** The neighbouring position in a direction, or null off the board. */
  step(pos: Pos, dir: Dir): Pos | null;
  /** On-board neighbours, in direction order. */
  neighbors(pos: Pos): Pos[];
  distance(a: Pos, b: Pos): number;
  /** The direction from one position to another if they lie on a straight line, else null. */
  directionTo(from: Pos, to: Pos): Dir | null;
  rotate(dir: Dir, turns: number): Dir;
  opposite(dir: Dir): Dir;
  /** Positions from `from` to `to` inclusive; consecutive entries are neighbours. */
  line(from: Pos, to: Pos): Pos[];
  /** Positions covered by a shape, in board order, without duplicates. */
  pattern(origin: Pos, facing: Dir, shape: PatternShape): Pos[];
}

/** Shared logic; subclasses supply geometry. */
export abstract class BaseTopology implements Topology {
  abstract readonly kind: string;
  abstract positions(): readonly Pos[];
  abstract contains(pos: Pos): boolean;
  abstract compare(a: Pos, b: Pos): number;
  abstract directions(): readonly Dir[];
  abstract distance(a: Pos, b: Pos): number;
  abstract directionTo(from: Pos, to: Pos): Dir | null;
  abstract line(from: Pos, to: Pos): Pos[];
  /** Unchecked step: the neighbouring key, which may be off the board. */
  protected abstract offset(pos: Pos, dir: Dir): Pos;
  /** Cone cells (possibly off-board) for an on-board origin. */
  protected abstract cone(origin: Pos, facing: Dir, length: number): Pos[];

  step(pos: Pos, dir: Dir): Pos | null {
    this.assertPos(pos);
    this.assertDir(dir);
    const next = this.offset(pos, dir);
    return this.contains(next) ? next : null;
  }

  neighbors(pos: Pos): Pos[] {
    const out: Pos[] = [];
    for (const dir of this.directions()) {
      const next = this.step(pos, dir);
      if (next !== null) out.push(next);
    }
    return out;
  }

  rotate(dir: Dir, turns: number): Dir {
    this.assertDir(dir);
    const dirs = this.directions();
    const n = dirs.length;
    return dirs[(((dirs.indexOf(dir) + turns) % n) + n) % n] as Dir;
  }

  opposite(dir: Dir): Dir {
    return this.rotate(dir, this.directions().length / 2);
  }

  pattern(origin: Pos, facing: Dir, shape: PatternShape): Pos[] {
    this.assertPos(origin);
    this.assertDir(facing);
    let cells: Pos[];
    switch (shape.kind) {
      case 'self':
        cells = [origin];
        break;
      case 'adjacent':
        cells = this.neighbors(origin);
        break;
      case 'line': {
        cells = [];
        let cur: Pos | null = origin;
        for (let i = 0; i < shape.length; i++) {
          cur = this.step(cur, facing);
          if (cur === null) break;
          cells.push(cur);
        }
        break;
      }
      case 'cone':
        cells = this.cone(origin, facing, shape.length);
        break;
      case 'ring':
        cells = this.positions().filter((p) => this.distance(origin, p) === shape.radius);
        break;
      case 'area':
        cells = this.positions().filter((p) => {
          const d = this.distance(origin, p);
          return d <= shape.radius && (d > 0 || shape.includeOrigin === true);
        });
        break;
      case 'offsets':
        cells = [];
        for (const path of shape.offsets) {
          let cur: Pos | null = origin;
          for (const turns of path) {
            cur = this.step(cur, this.rotate(facing, turns));
            if (cur === null) break;
          }
          if (cur !== null) cells.push(cur);
        }
        break;
    }
    return [...new Set(cells.filter((p) => this.contains(p)))].sort((a, b) => this.compare(a, b));
  }

  protected assertPos(pos: Pos): void {
    if (!this.contains(pos)) throw new RangeError(`${this.kind}: position '${pos}' is not on the board`);
  }

  protected assertDir(dir: Dir): void {
    if (!this.directions().includes(dir)) throw new RangeError(`${this.kind}: unknown direction '${dir}'`);
  }
}

/** True if nothing strictly between the two positions blocks the line. */
export function lineOfSight(topology: Topology, from: Pos, to: Pos, blocks: (pos: Pos) => boolean): boolean {
  return topology
    .line(from, to)
    .slice(1, -1)
    .every((p) => !blocks(p));
}

/**
 * Shortest path by A*, from `from` to `to` inclusive, or null if unreachable.
 * Every position after `from`, including `to`, must be passable. Step costs
 * default to 1 and must be at least 1 so the distance heuristic stays
 * admissible. Ties break by board order, so results are deterministic.
 */
export function findPath(
  topology: Topology,
  from: Pos,
  to: Pos,
  passable: (pos: Pos) => boolean,
  cost: (from: Pos, to: Pos) => number = () => 1,
): Pos[] | null {
  if (from === to) return [from];
  const open = new Map<Pos, { g: number; f: number }>([[from, { g: 0, f: topology.distance(from, to) }]]);
  const best = new Map<Pos, number>([[from, 0]]);
  const cameFrom = new Map<Pos, Pos>();
  const closed = new Set<Pos>();

  while (open.size > 0) {
    let current: Pos | undefined;
    let currentNode: { g: number; f: number } | undefined;
    for (const [pos, node] of open) {
      if (
        currentNode === undefined ||
        node.f < currentNode.f ||
        (node.f === currentNode.f && node.g > currentNode.g) ||
        (node.f === currentNode.f && node.g === currentNode.g && topology.compare(pos, current as Pos) < 0)
      ) {
        current = pos;
        currentNode = node;
      }
    }
    const pos = current as Pos;
    const node = currentNode as { g: number; f: number };
    if (pos === to) {
      const path = [pos];
      for (let p = cameFrom.get(pos); p !== undefined; p = cameFrom.get(p)) path.push(p);
      return path.reverse();
    }
    open.delete(pos);
    closed.add(pos);

    for (const next of topology.neighbors(pos)) {
      if (closed.has(next) || !passable(next)) continue;
      const g = node.g + cost(pos, next);
      if (g >= (best.get(next) ?? Infinity)) continue;
      best.set(next, g);
      cameFrom.set(next, pos);
      open.set(next, { g, f: g + topology.distance(next, to) });
    }
  }
  return null;
}
