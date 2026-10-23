/**
 * Hidden information (#53, requirement #48, decision #52). The engine keeps
 * full authoritative state; clients and fair AIs only ever receive a view for
 * one viewer, with events redacted the same way. Views are always derived,
 * never stored.
 */
import { clonePlain } from '../clone.js';
import { hashState } from '../hash.js';
import type { GameEvent, GameRules, GameState, ItemId, Outcome, Prompt, Side, SideId, TurnState } from './types.js';

/** Who may see something: everyone, its owner, no one, or specific sides. */
export type Visibility = 'public' | 'owner' | 'hidden' | { revealedTo: SideId[] };

export function canSee(visibility: Visibility | undefined, viewer: SideId | null, owner: SideId | null): boolean {
  const v = visibility ?? 'public';
  if (v === 'public') return true;
  if (v === 'hidden' || viewer === null) return false;
  if (v === 'owner') return viewer === owner;
  return v.revealedTo.includes(viewer);
}

/**
 * A stable placeholder id for a hidden thing that cannot be linked to its real
 * id without the game's secret. Bump `epoch` (e.g. on every shuffle) to issue
 * a fresh, unlinkable id.
 */
export function opaqueId(state: Pick<GameState<unknown>, 'secret'>, kind: string, id: string, epoch = 0): string {
  return `h${hashState(`${state.secret}|${kind}|${id}|${epoch}`).slice(0, 12)}`;
}

export interface ViewItem {
  id: ItemId;
  kind: string;
  controller: SideId | null;
  source: string | null;
  countered: boolean;
  /** Effects and variables only for the item's controller (variables can carry hidden events). */
  effects?: unknown[];
  vars?: Record<string, unknown>;
}

export interface GameView<W> {
  viewer: SideId | null;
  actionCount: number;
  sides: Side[];
  turn: TurnState;
  stack: ViewItem[];
  prompt: Prompt | null;
  outcome: Outcome | null;
  world: W;
}

/** What one viewer may know of the state: no random-generator state, secret or hidden world data. */
export function viewState<W>(rules: GameRules<W>, state: GameState<W>, viewer: SideId | null): GameView<W> {
  const world = clonePlain(state.world);
  rules.view?.(world, viewer, state);
  return {
    viewer,
    actionCount: state.actionCount,
    sides: clonePlain(state.sides),
    turn: clonePlain(state.turn),
    stack: state.stack.map((item) => {
      const own = viewer !== null && item.controller === viewer;
      // A face-down item shows others only that its controller played something.
      if (item.secret && !own) return { id: item.id, kind: 'hidden', controller: item.controller, source: null, countered: item.countered };
      return {
        id: item.id,
        kind: item.kind,
        controller: item.controller,
        source: item.source,
        countered: item.countered,
        ...(own && { effects: clonePlain(item.effects), vars: clonePlain(item.vars) }),
      };
    }),
    prompt: clonePlain(state.prompt),
    outcome: clonePlain(state.outcome),
    world,
  };
}

/** Events as one viewer may see them, given the state after they happened. */
export function redactEvents<W>(rules: GameRules<W>, events: GameEvent[], viewer: SideId | null, state: GameState<W>): GameEvent[] {
  return events.flatMap((original) => {
    let event = clonePlain(original);
    if (event.type === 'ItemAnnounced' && event.secret && (viewer === null || event.controller !== viewer)) {
      event = { type: event.type, item: event.item, controller: event.controller, secret: true, kind: 'hidden', source: null, cause: event.cause };
    }
    const redacted = rules.redact ? rules.redact(event, viewer, state) : event;
    return redacted ? [redacted] : [];
  });
}
