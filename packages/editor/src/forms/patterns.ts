/**
 * The pattern picker's board model (#40): a small board for each topology,
 * the cells a shape covers (straight from the topology, so the preview is
 * exactly what the engine will use), and the path offsets that select a
 * clicked cell.
 */
import { HexTopology, LaneTopology, SquareTopology, findPath, type Dir, type PatternShape, type Pos, type Topology } from '@ccg/core';

export type PreviewBoard = 'lane' | 'square' | 'hex';

export interface PreviewSetup {
  topology: Topology;
  origin: Pos;
  facing: Dir;
}

export function previewSetup(board: PreviewBoard): PreviewSetup {
  switch (board) {
    case 'lane':
      return { topology: new LaneTopology(9), origin: '4', facing: 'e' };
    case 'square':
      return { topology: new SquareTopology({ width: 9, height: 9, connectivity: 8 }), origin: '4,4', facing: 'e' };
    case 'hex':
      return { topology: HexTopology.hexagon(4), origin: '0,0', facing: 'e' };
  }
}

/** The cells a shape covers from the preview origin. Invalid shapes cover nothing. */
export function previewCells(setup: PreviewSetup, shape: PatternShape): Pos[] {
  try {
    return setup.topology.pattern(setup.origin, setup.facing, shape);
  } catch {
    return [];
  }
}

/**
 * The offset path (turns from facing, one per step) from the origin to a
 * cell, so that `{ kind: 'offsets', offsets: [path] }` selects exactly it.
 */
export function offsetPath(setup: PreviewSetup, cell: Pos): number[] | null {
  const { topology: t, origin, facing } = setup;
  const path = findPath(t, origin, cell, () => true);
  if (!path || path.length < 2) return null;
  const dirs = t.directions();
  const n = dirs.length;
  const out: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const dir = t.directionTo(path[i - 1] as Pos, path[i] as Pos);
    if (dir === null) return null;
    let turns = (dirs.indexOf(dir) - dirs.indexOf(facing) + n) % n;
    // Prefer the smaller turn either way (e.g. -1 rather than 7).
    if (turns > n / 2) turns -= n;
    out.push(turns);
  }
  return out;
}

/** Guesses a project's board from its encounters' positions: "3" is a lane; "x,y" a grid. */
export function guessBoard(positions: string[]): PreviewBoard {
  if (positions.length > 0 && positions.every((p) => /^\d+$/.test(p))) return 'lane';
  if (positions.some((p) => /^-\d+,|,-\d+$/.test(p))) return 'hex';
  return 'square';
}
