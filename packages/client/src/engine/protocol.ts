/**
 * The typed message API between the UI and the engine (#28). The engine runs
 * behind it (in a Web Worker on web) and only ever sends the human side's
 * view and redacted events (requirement #48: clients never see full state).
 */
import type { Action, ApplyError, GameEvent, GameState, GameView, SideId } from '@ccg/core';

export interface GameListing {
  id: string;
  name: string;
  version: string;
  description?: string;
}

export type EngineRequest =
  | { type: 'listGames' }
  | { type: 'start'; game: string; seed: string | number; encounter?: string; scenario?: string; /** Cards drawn first, e.g. to try one out. */ hand?: string[] }
  | { type: 'act'; action: Action }
  /** Loads a game package from a zip (as the editor exports), replacing one with the same id. */
  | { type: 'importZip'; data: Uint8Array }
  /** Loads a game package from its files (e.g. the editor's live project), replacing one with the same id. */
  | { type: 'loadFiles'; files: Record<string, Uint8Array> }
  /** Loads new files for the running game's package and applies them to the game in progress (#42). */
  | { type: 'reload'; files: Record<string, Uint8Array>; mode: 'hot' | 'replay' }
  /** In a run, between encounters: take one of the offered cards (or none) and go on. */
  | { type: 'chooseReward'; card: string | null }
  /** In a branching run: go to one of the next nodes. */
  | { type: 'chooseNode'; node: string }
  /** At a spring (heal or remove a card) or fruiting log (take a hybrid or upgrade a card), or leave (#103). */
  | { type: 'chooseService'; choice: ServiceChoice }
  /** Takes back the player's last action, when the game allows it (#83). */
  | { type: 'undo' }
  /** Debug hosts only (#46): the authoritative state after `at` actions (default: now), with every action's events. */
  | { type: 'debug'; at?: number }
  /** Debug hosts only: rewind to after `at` actions and play on from there, dropping the later ones. */
  | { type: 'branch'; at: number }
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
  /** The card's tags, e.g. its strain. */
  tags: string[];
  /** The card once upgraded, if it can be. */
  upgrade?: CardFace;
  /** Activated ability names by ability index, for a permanent card. */
  abilities: Record<string, string>;
  art?: string;
}

/** Static display data for a game's content, keyed by qualified content id. */
export interface Catalog {
  names: Record<string, string>;
  cards: Record<string, CardFace>;
  statuses: Record<string, { name: string; description?: string; stacking: string }>;
  /** Art URLs by content id: unit sprites, tile art, status icons. */
  art: Record<string, string>;
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
  /** A message about what the request did, e.g. how a reload applied changes. */
  notice?: string;
  /** The scene the current encounter is set in. */
  scene?: { background?: string };
  /** Progress through a run (#45). */
  run?: RunProgress;
  /** Whether `undo` would take back the player's last action now. */
  canUndo: boolean;
}

export type ServiceChoice =
  | { action: 'heal' }
  | { action: 'remove'; index: number }
  | { action: 'take'; card: string }
  | { action: 'upgrade'; index: number }
  | { action: 'leave' };

export interface RunProgress {
  /** Nodes entered so far (the current one included). */
  stage: number;
  /** The run's length: the most nodes any path visits. */
  total: number;
  /** `reward`: won, choose a card; `map`: choose the next node; `service`: at a spring or fruiting log; `won`/`lost`: over. */
  status: 'playing' | 'reward' | 'map' | 'service' | 'won' | 'lost';
  /** At a spring or fruiting log: which, and the hybrids a fruiting log offers. */
  service?: { kind: 'spring' | 'fruiting'; offer: string[] };
  /** The run's deck, in order (for removing or upgrading cards). */
  deck: { def: string; upgraded?: boolean }[];
  /** Card ids on offer when `status` is `reward`. */
  rewards?: string[];
  /** `strain`: a junction's offer, where taking a card connects its strain (#101). */
  offer?: 'card' | 'strain';
  /** The run's strains and which are connected. */
  strains?: { all: string[]; unlocked: string[] };
  /** A branching run's map (#100). */
  map?: {
    nodes: { id: string; kind: string; name: string; depth: number; next: string[] }[];
    visited: string[];
    current: string;
    /** Nodes the player may go to now. */
    choices: string[];
  };
}

/** What the debugger sees (#46): the full game, not one side's view. */
export interface DebugInfo {
  /** Every action so far with the events it caused, unredacted. */
  actions: { action: Action; events: GameEvent[] }[];
  /** The state shown is the one after this many actions (0: the starting state). */
  at: number;
  state: GameState<unknown>;
  /** The state one action earlier, for diffs; null at the start. */
  previous: GameState<unknown> | null;
  /** Each side's view of `state`. */
  views: Record<SideId, GameView<unknown>>;
}

export type EngineReply =
  | { ok: true; type: 'games'; games: GameListing[]; /** The package a zip import loaded. */ loaded?: string }
  | { ok: true; type: 'snapshot'; snapshot: Snapshot }
  | { ok: true; type: 'debug'; debug: DebugInfo }
  | { ok: false; error: ApplyError | { code: 'not-started' | 'unknown-game' | 'invalid-package'; message: string } };
