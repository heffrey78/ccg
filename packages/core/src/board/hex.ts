import { BaseTopology, type Dir, type Pos, type TopologyLayout } from './topology.js';

type Axial = readonly [number, number];

/**
 * Pointy-top axial coordinates (q, r), clockwise from east, with r growing
 * downwards on screen.
 */
const VECTORS: Record<string, Axial> = {
  e: [1, 0],
  se: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
  nw: [0, -1],
  ne: [1, -1],
};
const DIRS = ['e', 'se', 'sw', 'w', 'nw', 'ne'] as const;

/** A hex map of cells "q,r", in board order by r then q. Any cell set is allowed. */
export class HexTopology extends BaseTopology {
  readonly kind = 'hex';
  readonly #positions: Pos[];
  readonly #cells: Set<Pos>;

  constructor(cells: Iterable<Axial>) {
    super();
    this.#cells = new Set([...cells].map(([q, r]) => key(q, r)));
    if (this.#cells.size === 0) throw new RangeError('hex map needs at least one cell');
    this.#positions = [...this.#cells].sort((a, b) => this.compare(a, b));
  }

  /** A hexagon-shaped map centred on "0,0". */
  static hexagon(radius: number): HexTopology {
    if (!Number.isInteger(radius) || radius < 0) throw new RangeError('hex radius must be a non-negative integer');
    const cells: Axial[] = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) cells.push([q, r]);
    }
    return new HexTopology(cells);
  }

  positions(): readonly Pos[] {
    return this.#positions;
  }

  layout(): TopologyLayout {
    return {
      kind: this.kind,
      cell: 'hex',
      cells: this.#positions.map((pos) => ({ pos, ...screen(coords(pos)) })),
      directions: Object.fromEntries(DIRS.map((d) => [d, screen(VECTORS[d] as Axial)])),
    };
  }

  contains(pos: Pos): boolean {
    return this.#cells.has(pos);
  }

  compare(a: Pos, b: Pos): number {
    const [aq, ar] = coords(a);
    const [bq, br] = coords(b);
    return ar - br || aq - bq;
  }

  directions(): readonly Dir[] {
    return DIRS;
  }

  distance(a: Pos, b: Pos): number {
    const [aq, ar] = coords(a);
    const [bq, br] = coords(b);
    const dq = aq - bq;
    const dr = ar - br;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  directionTo(from: Pos, to: Pos): Dir | null {
    const [fq, fr] = coords(from);
    const [tq, tr] = coords(to);
    const k = this.distance(from, to);
    if (k === 0) return null;
    return DIRS.find((d) => {
      const [vq, vr] = VECTORS[d] as Axial;
      return fq + vq * k === tq && fr + vr * k === tr;
    }) ?? null;
  }

  line(from: Pos, to: Pos): Pos[] {
    const [q0, r0] = coords(from);
    const [q1, r1] = coords(to);
    const n = this.distance(from, to);
    const out: Pos[] = [];
    // Nudge off exact cell edges so ties always round the same way.
    const eq = 1e-6;
    const er = 2e-6;
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      out.push(roundAxial(q0 + eq + (q1 - q0) * t, r0 + er + (r1 - r0) * t));
    }
    return out;
  }

  protected offset(pos: Pos, dir: Dir): Pos {
    const [q, r] = coords(pos);
    const [dq, dr] = VECTORS[dir] as Axial;
    return key(q + dq, r + dr);
  }

  /** A 120° cone: everything reachable by k forward steps plus side steps either way. */
  protected cone(origin: Pos, facing: Dir, length: number): Pos[] {
    const [q, r] = coords(origin);
    const [fq, fr] = VECTORS[facing] as Axial;
    const out: Pos[] = [];
    for (const side of [this.rotate(facing, -1), this.rotate(facing, 1)]) {
      const [sq, sr] = VECTORS[side] as Axial;
      for (let a = 0; a <= length; a++) {
        for (let b = 0; a + b <= length; b++) {
          if (a + b > 0) out.push(key(q + fq * a + sq * b, r + fr * a + sr * b));
        }
      }
    }
    return out;
  }
}

const key = (q: number, r: number): Pos => `${q + 0},${r + 0}`;

/** Pointy-top screen position with neighbouring centres 1 apart. */
const screen = ([q, r]: Axial) => ({ x: q + r / 2, y: (r * Math.sqrt(3)) / 2 });

function coords(pos: Pos): Axial {
  const m = /^(-?\d+),(-?\d+)$/.exec(pos);
  if (!m) throw new RangeError(`hex: malformed position '${pos}'`);
  return [Number(m[1]), Number(m[2])];
}

function roundAxial(q: number, r: number): Pos {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return key(rq, rr);
}
