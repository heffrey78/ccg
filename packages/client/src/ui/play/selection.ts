/**
 * Turns the legal action list into what the encounter screen offers: which
 * hand cards, units and abilities can act, and where each choice lands on
 * the board. Pure, so it is unit tested without a DOM.
 */
import type { Action } from '@ccg/core';
import type { BoardView, Layout, WorldView } from './world.js';

/** What the player has picked and is now choosing a target for. */
export type Selection =
  | { kind: 'card'; card: string }
  | { kind: 'unit'; unit: string }
  | { kind: 'ability'; permanent: string; ability: number }
  | null;

/** Where a choice shows on the board: a unit, a tile, or a direction from the acting unit. */
export type Anchor = { kind: 'unit'; unit: string } | { kind: 'tile'; pos: string } | { kind: 'direction'; dir: string; from: string | null } | { kind: 'none' };

export interface Choice {
  action: Action;
  anchor: Anchor;
}

export interface Offers {
  /** Hand card instance id → its legal plays. */
  cards: Map<string, Action[]>;
  /** Unit id → its legal moves. */
  units: Map<string, Action[]>;
  /** `permanent:ability` → its legal activations. */
  abilities: Map<string, Action[]>;
  endTurn: Action | null;
  pass: Action | null;
  /** Anything this screen has no special control for. */
  other: Action[];
}

const push = (map: Map<string, Action[]>, key: string, action: Action) => map.set(key, [...(map.get(key) ?? []), action]);

export function offers(legal: Action[]): Offers {
  const out: Offers = { cards: new Map(), units: new Map(), abilities: new Map(), endTurn: null, pass: null, other: [] };
  for (const action of legal) {
    if (action.type === 'playCard') push(out.cards, action.card as string, action);
    else if (action.type === 'move') push(out.units, action.unit as string, action);
    else if (action.type === 'activate') push(out.abilities, `${String(action.permanent)}:${String(action.ability)}`, action);
    else if (action.type === 'endTurn') out.endTurn = action;
    else if (action.type === 'pass') out.pass = action;
    else out.other.push(action);
  }
  return out;
}

export function actionsFor(selection: Selection, o: Offers): Action[] {
  if (!selection) return [];
  if (selection.kind === 'card') return o.cards.get(selection.card) ?? [];
  if (selection.kind === 'unit') return o.units.get(selection.unit) ?? [];
  return o.abilities.get(`${selection.permanent}:${selection.ability}`) ?? [];
}

/** The unit that acts for a side: its earliest unit, as the board's default targeting assumes. */
export function actorOf(board: BoardView | undefined, side: string): string | null {
  const own = Object.values(board?.units ?? {}).filter((u) => u.side === side);
  own.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1));
  return own[0]?.id ?? null;
}

export function anchorOf(action: Action, world: WorldView, layout: Layout | null, actor: string | null): Anchor {
  const board = world.board;
  const target = action.type === 'move' ? action.to : action.target;
  if (typeof target !== 'string') return { kind: 'none' };
  if (action.type !== 'move' && board?.units[target]) return { kind: 'unit', unit: target };
  if (layout?.cells.some((c) => c.pos === target)) return { kind: 'tile', pos: target };
  if (layout && target in layout.directions) {
    // An ability's direction is measured from its permanent's unit.
    const from = action.type === 'activate' ? (world.permanents?.[action.permanent as string]?.unit ?? null) : actor;
    return { kind: 'direction', dir: target, from: from ? (board?.units[from]?.pos ?? null) : null };
  }
  return { kind: 'none' };
}

export function choicesFor(selection: Selection, o: Offers, world: WorldView, layout: Layout | null, side: string): Choice[] {
  const actor = actorOf(world.board, side);
  return actionsFor(selection, o).map((action) => ({ action, anchor: anchorOf(action, world, layout, actor) }));
}

/** The board cell a choice lights up, if any. */
export function anchorCell(anchor: Anchor, board: BoardView | undefined, layout: Layout | null): string | null {
  switch (anchor.kind) {
    case 'unit':
      return board?.units[anchor.unit]?.pos ?? null;
    case 'tile':
      return anchor.pos;
    case 'direction': {
      if (!layout || anchor.from === null) return null;
      const from = layout.cells.find((c) => c.pos === anchor.from);
      const v = layout.directions[anchor.dir];
      if (!from || !v) return null;
      const next = layout.cells.find((c) => Math.abs(c.x - (from.x + v.x)) < 0.01 && Math.abs(c.y - (from.y + v.y)) < 0.01);
      return next?.pos ?? null;
    }
    case 'none':
      return null;
  }
}
