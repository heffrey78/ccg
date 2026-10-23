/**
 * The typed message API between the UI and the engine (#28). The engine runs
 * behind it (in a Web Worker on web) and only ever sends the human side's
 * view and redacted events (requirement #48: clients never see full state).
 */
import type { Action, ApplyError, GameEvent, GameView, SideId } from '@ccg/core';

export interface GameListing {
  id: string;
  name: string;
  version: string;
  description?: string;
}

export type EngineRequest =
  | { type: 'listGames' }
  | { type: 'start'; game: string; seed: string | number; encounter?: string }
  | { type: 'act'; action: Action }
  | { type: 'view' };

/** What the UI knows after each request. */
export interface Snapshot {
  game: GameListing;
  /** The side the UI plays. */
  side: SideId;
  view: GameView<unknown>;
  /** Events since the last snapshot, redacted for `side` (including anything the AI did). */
  events: GameEvent[];
  /** Whose decision the game is waiting on. */
  deciding: SideId | null;
  /** The UI side's legal actions, when it is deciding. */
  legal: Action[];
  /** Display names for content ids (cards, units, statuses). */
  names: Record<string, string>;
}

export type EngineReply =
  | { ok: true; type: 'games'; games: GameListing[] }
  | { ok: true; type: 'snapshot'; snapshot: Snapshot }
  | { ok: false; error: ApplyError | { code: 'not-started' | 'unknown-game' | 'invalid-package'; message: string } };
