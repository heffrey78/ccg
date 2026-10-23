/**
 * Encounters on the game's board (#45): the board a project's ruleset
 * describes, which encounter positions fall off it, and moving positions
 * when the board's shape changes.
 */
import { topologyOf, type RulesetDef, type Topology } from '@ccg/core';
import type { ContentItem } from '@ccg/content';
import type { Command } from './commands.js';
import { itemsOfKind, type Project } from './project.js';

export interface ProjectBoard {
  ruleset: string;
  def: RulesetDef['board'];
  topology: Topology;
}

/** The board of the project's first ruleset, if it has a valid one. */
export function projectBoard(project: Project): ProjectBoard | null {
  const first = itemsOfKind(project, 'ruleset')[0];
  if (!first) return null;
  const def = (first[1] as unknown as RulesetDef).board;
  try {
    return { ruleset: first[1].id, def, topology: topologyOf(def) };
  } catch {
    return null;
  }
}

interface EncounterFields {
  units?: { unit: string; side: string; pos: string; facing?: string }[];
  tiles?: Record<string, string>;
}

const escape = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1');

/** Positions in encounters that are not on the board, and units sharing a tile. */
export function boardIssues(project: Project, board: ProjectBoard): { key: string; pointer: string; message: string }[] {
  const out: { key: string; pointer: string; message: string }[] = [];
  const shape = describeBoard(board.def);
  for (const [key, item] of itemsOfKind(project, 'encounter')) {
    const e = item as unknown as EncounterFields;
    const seen = new Map<string, number>();
    (e.units ?? []).forEach((u, i) => {
      if (!board.topology.contains(u.pos)) out.push({ key, pointer: `/units/${i}/pos`, message: `'${u.pos}' is not on the board (${shape})` });
      else if (seen.has(u.pos)) out.push({ key, pointer: `/units/${i}/pos`, message: `two units start on '${u.pos}' (see unit ${(seen.get(u.pos) as number) + 1})` });
      seen.set(u.pos, i);
    });
    for (const pos of Object.keys(e.tiles ?? {})) {
      if (!board.topology.contains(pos)) out.push({ key, pointer: `/tiles/${escape(pos)}`, message: `'${pos}' is not on the board (${shape})` });
    }
  }
  return out;
}

export function describeBoard(def: RulesetDef['board']): string {
  switch (def.topology) {
    case 'lane':
      return `a lane of ${def.length}`;
    case 'square':
      return `a ${def.width}×${def.height} grid`;
    case 'hex':
      return `a hexagon of radius ${def.radius}`;
  }
}

/** Board-independent (column, row) for a position, given the kind of board it was written for. */
function toGrid(pos: string, kind: RulesetDef['board']['topology']): [number, number] | null {
  const m = /^(-?\d+)(?:,(-?\d+))?$/.exec(pos);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? 0 : Number(m[2]);
  // Hex columns are offset by half a row so rows stay straight.
  return kind === 'hex' ? [a + Math.floor(b / 2), b] : [a, b];
}

function fromGrid([col, row]: [number, number], def: RulesetDef['board'], sourceRows: number): string {
  switch (def.topology) {
    case 'lane':
      return String(col);
    case 'square':
      // A one-row source (a lane) goes in the middle row.
      return `${col},${sourceRows === 1 ? Math.floor(def.height / 2) : row}`;
    case 'hex': {
      const r = sourceRows === 1 ? 0 : row - def.radius;
      const q = col - def.radius - Math.floor(r / 2);
      return `${q},${r}`;
    }
  }
}

/**
 * Moves every encounter's positions from the board kind they were written
 * for to the project's current board, keeping columns and rows where they
 * can. What still falls off the board is left for validation to flag.
 */
export function moveEncounters(from: RulesetDef['board']['topology'], to: RulesetDef['board']): Command {
  return (project) => {
    const items: Record<string, ContentItem> = { ...project.items };
    for (const [key, item] of itemsOfKind(project, 'encounter')) {
      const e = item as unknown as EncounterFields;
      const grid = [...(e.units ?? []).map((u) => u.pos), ...Object.keys(e.tiles ?? {})].map((p) => toGrid(p, from)).filter((g): g is [number, number] => g !== null);
      const rows = new Set(grid.map(([, r]) => r)).size;
      const move = (pos: string) => {
        const g = toGrid(pos, from);
        return g ? fromGrid(g, to, rows) : pos;
      };
      const next = { ...item } as ContentItem & EncounterFields;
      if (e.units) next.units = e.units.map((u) => ({ ...u, pos: move(u.pos) }));
      if (e.tiles) next.tiles = Object.fromEntries(Object.entries(e.tiles).map(([p, t]) => [move(p), t]));
      items[key] = next;
    }
    return { ...project, items };
  };
}
