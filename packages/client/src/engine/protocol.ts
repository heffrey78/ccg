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
  /** Loads a game package from a zip (as the editor exports), replacing one with the same id. */
  | { type: 'importZip'; data: Uint8Array }
  | { type: 'view' };

/** A card as the UI shows it: text is generated from its effects (decision #12). */
export interface CardFace {
  name: string;
  text: string;
  /** What the card asks for, e.g. "Target an enemy within 1." */
  targeting: string;
  cost: Record<string, number>;
  timing: 'main' | 'reaction' | 'any';
  keywords: string[];
  /** Activated ability names by ability index, for a permanent card. */
  abilities: Record<string, string>;
  art?: string;
}

/** Static display data for a game's content, keyed by qualified content id. */
export interface Catalog {
  names: Record<string, string>;
  cards: Record<string, CardFace>;
  statuses: Record<string, { name: string; description?: string; stacking: string }>;
}

/** What a visible enemy intent will do, for the telegraph. */
export interface IntentSummary {
  text: string;
  /** Total direct damage, when the intent's damage amounts are fixed numbers. */
  damage?: number;
}

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
  catalog: Catalog;
  /** The rules' static presentation data, e.g. `board` (a BoardPresentation). */
  presentation: Record<string, unknown>;
  /** Summaries of the intents in `view`, by intent id. */
  intents: Record<string, IntentSummary>;
}

export type EngineReply =
  | { ok: true; type: 'games'; games: GameListing[]; /** The package a zip import loaded. */ loaded?: string }
  | { ok: true; type: 'snapshot'; snapshot: Snapshot }
  | { ok: false; error: ApplyError | { code: 'not-started' | 'unknown-game' | 'invalid-package'; message: string } };
