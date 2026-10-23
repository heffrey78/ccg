import { BaseTopology, type Dir, type Pos } from './topology.js';

type Vec = readonly [number, number];

/** North is -y (screen coordinates), east is +x. Clockwise from north. */
const VECTORS: Record<string, Vec> = {
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
  nw: [-1, -1],
};
const DIRS4 = ['n', 'e', 's', 'w'] as const;
const DIRS8 = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

export interface SquareOptions {
  width: number;
  height: number;
  /** 4: orthogonal moves, Manhattan distance. 8: diagonals too, Chebyshev distance. */
  connectivity?: 4 | 8;
}

/** A rectangular grid of cells "x,y", in row-major board order. */
export class SquareTopology extends BaseTopology {
  readonly kind = 'square';
  readonly width: number;
  readonly height: number;
  readonly connectivity: 4 | 8;
  readonly #positions: Pos[];

  constructor({ width, height, connectivity = 4 }: SquareOptions) {
    super();
    for (const [name, v] of [
      ['width', width],
      ['height', height],
    ] as const) {
      if (!Number.isInteger(v) || v < 1) throw new RangeError(`square ${name} must be a positive integer`);
    }
    this.width = width;
    this.height = height;
    this.connectivity = connectivity;
    this.#positions = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) this.#positions.push(key(x, y));
  }

  positions(): readonly Pos[] {
    return this.#positions;
  }

  contains(pos: Pos): boolean {
    const c = parse(pos);
    return c !== null && c[0] < this.width && c[1] < this.height && c[0] >= 0 && c[1] >= 0;
  }

  compare(a: Pos, b: Pos): number {
    const [ax, ay] = coords(a);
    const [bx, by] = coords(b);
    return ay - by || ax - bx;
  }

  directions(): readonly Dir[] {
    return this.connectivity === 8 ? DIRS8 : DIRS4;
  }

  distance(a: Pos, b: Pos): number {
    const dx = Math.abs(coords(a)[0] - coords(b)[0]);
    const dy = Math.abs(coords(a)[1] - coords(b)[1]);
    return this.connectivity === 8 ? Math.max(dx, dy) : dx + dy;
  }

  directionTo(from: Pos, to: Pos): Dir | null {
    const [fx, fy] = coords(from);
    const [tx, ty] = coords(to);
    const dx = tx - fx;
    const dy = ty - fy;
    if (dx === 0 && dy === 0) return null;
    if (dx !== 0 && dy !== 0 && (this.connectivity === 4 || Math.abs(dx) !== Math.abs(dy))) return null;
    const unit: Vec = [Math.sign(dx), Math.sign(dy)];
    return this.directions().find((d) => sameVec(VECTORS[d] as Vec, unit)) ?? null;
  }

  line(from: Pos, to: Pos): Pos[] {
    const [x0, y0] = coords(from);
    const [x1, y1] = coords(to);
    return this.connectivity === 8 ? lerpLine(x0, y0, x1, y1) : orthogonalLine(x0, y0, x1, y1);
  }

  protected offset(pos: Pos, dir: Dir): Pos {
    const [x, y] = coords(pos);
    const [dx, dy] = VECTORS[dir] as Vec;
    return key(x + dx, y + dy);
  }

  /**
   * Orthogonal facing: row k (1..length) ahead spans 2k-1 cells. Diagonal
   * facing (8-connected only): the quadrant within Chebyshev distance `length`.
   */
  protected cone(origin: Pos, facing: Dir, length: number): Pos[] {
    const [x, y] = coords(origin);
    const [fx, fy] = VECTORS[facing] as Vec;
    const out: Pos[] = [];
    if (fx !== 0 && fy !== 0) {
      for (let a = 0; a <= length; a++) {
        for (let b = 0; b <= length; b++) if (a + b > 0) out.push(key(x + fx * a, y + fy * b));
      }
      return out;
    }
    const [px, py] = [-fy, fx];
    for (let k = 1; k <= length; k++) {
      for (let j = -(k - 1); j <= k - 1; j++) out.push(key(x + fx * k + px * j, y + fy * k + py * j));
    }
    return out;
  }
}

const key = (x: number, y: number): Pos => `${x},${y}`;

function parse(pos: Pos): Vec | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(pos);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function coords(pos: Pos): Vec {
  const c = parse(pos);
  if (c === null) throw new RangeError(`square: malformed position '${pos}'`);
  return c;
}

const sameVec = (a: Vec, b: Vec) => a[0] === b[0] && a[1] === b[1];

/** Cells along the line with diagonal steps allowed (rounded interpolation). */
function lerpLine(x0: number, y0: number, x1: number, y1: number): Pos[] {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const out: Pos[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push(key(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t)));
  }
  return out;
}

/** Cells along the line using only orthogonal steps; ties step vertically. */
function orthogonalLine(x0: number, y0: number, x1: number, y1: number): Pos[] {
  const nx = Math.abs(x1 - x0);
  const ny = Math.abs(y1 - y0);
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  const out = [key(x, y)];
  for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
    // Compare (0.5 + ix) / nx with (0.5 + iy) / ny without dividing.
    if ((1 + 2 * ix) * ny < (1 + 2 * iy) * nx) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    out.push(key(x, y));
  }
  return out;
}
