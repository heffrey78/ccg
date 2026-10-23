import { BaseTopology, type Dir, type Pos, type TopologyLayout } from './topology.js';

const DIRS = ['e', 'w'] as const;

/** A single row of cells "0" to "length-1"; east is increasing. */
export class LaneTopology extends BaseTopology {
  readonly kind = 'lane';
  readonly #positions: Pos[];

  constructor(readonly length: number) {
    super();
    if (!Number.isInteger(length) || length < 1) throw new RangeError(`lane length must be a positive integer`);
    this.#positions = Array.from({ length }, (_, i) => String(i));
  }

  positions(): readonly Pos[] {
    return this.#positions;
  }

  layout(): TopologyLayout {
    return {
      kind: this.kind,
      cell: 'square',
      cells: this.#positions.map((pos) => ({ pos, x: Number(pos), y: 0 })),
      directions: { e: { x: 1, y: 0 }, w: { x: -1, y: 0 } },
    };
  }

  contains(pos: Pos): boolean {
    const i = index(pos);
    return i !== null && i < this.length;
  }

  compare(a: Pos, b: Pos): number {
    return Number(a) - Number(b);
  }

  directions(): readonly Dir[] {
    return DIRS;
  }

  distance(a: Pos, b: Pos): number {
    return Math.abs(Number(a) - Number(b));
  }

  directionTo(from: Pos, to: Pos): Dir | null {
    const d = Number(to) - Number(from);
    return d > 0 ? 'e' : d < 0 ? 'w' : null;
  }

  line(from: Pos, to: Pos): Pos[] {
    const a = Number(from);
    const b = Number(to);
    const sign = b >= a ? 1 : -1;
    return Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => String(a + i * sign));
  }

  protected offset(pos: Pos, dir: Dir): Pos {
    return String(Number(pos) + (dir === 'e' ? 1 : -1));
  }

  /** A lane has no width, so a cone is a line. */
  protected cone(origin: Pos, facing: Dir, length: number): Pos[] {
    return this.pattern(origin, facing, { kind: 'line', length });
  }
}

function index(pos: Pos): number | null {
  return /^(0|[1-9]\d*)$/.test(pos) ? Number(pos) : null;
}
