/**
 * Core types for the resolution kernel. See docs/design/resolution-order.md for
 * the rules these implement; section references (§n) point there.
 *
 * Game state is plain, serializable data. The kernel is generic over `W`, the
 * game's own world data (boards, units, zones...), which later modules and game
 * packages define.
 */
import type { RngState } from '../rng.js';
import type { Rng } from '../rng.js';

export type SideId = string;
export type EntityId = string;
export type ItemId = string;

/** Who chooses a side's actions. Remote players arrive with multiplayer (#51). */
export type ControllerKind = 'human' | 'ai';

export interface Side {
  id: SideId;
  controller: ControllerKind;
}

export interface TurnState {
  round: number;
  /** Index into the expanded round schedule (see `schedule()`). */
  slot: number;
  phase: string;
  /** The side whose phase this is, or null for phases that belong to no side. */
  activeSide: SideId | null;
  /** The active side has ended its interactive phase; set only while a phase-end window is pending. */
  ending?: boolean;
  /** This phase's phase-end window has happened; set only when such windows are enabled. */
  endWindowDone?: boolean;
}

/**
 * A primitive op with its parameters, as written in content. Any parameter may
 * be a variable reference `{ $: 'path.to.var' }`, resolved when the effect
 * starts (§3.1).
 */
export interface Effect {
  op: string;
  [param: string]: unknown;
}

export interface StackItem {
  id: ItemId;
  /** What produced the item, e.g. 'card', 'ability', 'trigger', 'rules'. */
  kind: string;
  /** The side that controls the item; null for game rules. */
  controller: SideId | null;
  source: EntityId | null;
  effects: Effect[];
  /** Variables visible to the item's effects (§3.1). */
  vars: Record<string, unknown>;
  countered: boolean;
  /** Played face-down: other viewers see only that the controller played something (#56). */
  secret?: boolean;
  /** Whether the response window for the item's current turn at the top has happened (§5). */
  windowDone?: boolean;
  /** Whether the item has had its first (`itemAnnounced`) window. */
  announced?: boolean;
}

/** Fields the kernel fills in when an item is announced. */
export type NewItem = Omit<StackItem, 'id' | 'countered' | 'windowDone' | 'announced'>;

export interface Outcome {
  winners: SideId[];
  reason: string;
}

/** Timing points at which a response window may open (resolution-order §5.1). */
export type WindowTiming = 'itemAnnounced' | 'itemTop' | 'phaseEnd';

/**
 * The game is paused for a side's decision. `priority`: a response window is
 * open and `side` may respond or pass (§5.2).
 */
export interface Prompt {
  kind: 'priority';
  window: WindowTiming;
  /** The item being responded to; null for a phase-end window. */
  item: ItemId | null;
  side: SideId;
  /** Priority order for this window. */
  order: SideId[];
  /** Sides that have passed (or had nothing to play) in this window. */
  passed: SideId[];
}

export interface GameState<W = unknown> {
  format: 1;
  /** Monotonic counter for ids and timestamps. */
  seq: number;
  /** Number of actions applied so far. */
  actionCount: number;
  rng: RngState;
  /** Per-game secret for opaque ids of hidden things (#53). Never included in views. */
  secret: string;
  sides: Side[];
  turn: TurnState;
  /** Bottom first; the top item is the last element. */
  stack: StackItem[];
  prompt: Prompt | null;
  outcome: Outcome | null;
  world: W;
}

/** A step before it applies: modifiers can change, replace or prevent it (§3). */
export interface Step {
  kind: string;
  [field: string]: unknown;
}

/** An event as a step handler produces it, before the kernel adds its cause. */
export interface EventInput {
  type: string;
  [field: string]: unknown;
}

/** Where an event came from (§12). */
export interface Cause {
  action: number;
  item?: ItemId;
  effect?: number;
  /** The listener (interrupt or trigger) whose effects produced the event. */
  via?: string;
}

export interface GameEvent extends EventInput {
  cause: Cause;
}

export interface Action {
  type: string;
  side: SideId;
  [field: string]: unknown;
}

/** Ordering layer of a listener's source, earliest first (§6.3). */
export type ListenerLayer = 'rules' | 'status' | 'permanent' | 'innate' | 'card';

interface ListenerBase {
  /** Stable id, unique among the listeners active at one moment. */
  id: string;
  /** Variables its effects see, besides `event` (e.g. a status's holder and stacks). */
  vars?: Record<string, unknown>;
  source: EntityId | null;
  controller: SideId | null;
  layer: ListenerLayer;
  /** When the source entered play or was created; lower orders first. */
  timestamp: number;
}

export interface Modifier<W = unknown> extends ListenerBase {
  kind: 'modifier';
  matches(step: Step, state: GameState<W>): boolean;
  /** Returns the steps to apply instead: `[step]` changed, `[]` prevented, several replaced. */
  modify(step: Step, state: GameState<W>): Step[];
}

export interface Interrupt<W = unknown> extends ListenerBase {
  kind: 'interrupt';
  matches(event: GameEvent, state: GameState<W>): boolean;
  effects: Effect[];
  /** Stop the effect that produced the event (e.g. end the remaining movement). */
  halt?: boolean;
}

export interface Trigger<W = unknown> extends ListenerBase {
  kind: 'trigger';
  matches(event: GameEvent, state: GameState<W>): boolean;
  effects: Effect[];
}

export type Listener<W = unknown> = Modifier<W> | Interrupt<W> | Trigger<W>;

export interface StepOutcome {
  events: GameEvent[];
  /** An interrupt asked the current effect to stop. */
  halted: boolean;
}

/** What an op handler gets while one effect resolves. */
export interface EffectContext<W = unknown> {
  readonly state: GameState<W>;
  readonly item: StackItem;
  readonly rng: Rng;
  /**
   * Applies one step, or several simultaneously (§3.2): modifiers, then the
   * steps, then interrupts, then one round of state checks.
   */
  step(steps: Step | Step[]): StepOutcome;
  /** Sets a variable for this item's later effects (§3.1). */
  setVar(name: string, value: unknown): void;
  /** Runs nested effects inline, in order, as part of this effect (e.g. an `if` op's branch). */
  run(effects: Effect[]): void;
  newId(prefix: string): string;
}

/** Turns an effect's resolved parameters into steps. */
export type OpHandler<W = unknown> = (ctx: EffectContext<W>, params: Record<string, unknown>) => void;

/** Applies a step to state (mutating the working copy) and reports what happened. */
export type StepHandler<W = unknown> = (state: GameState<W>, step: Step) => EventInput[];

export interface CheckContext<W = unknown> {
  readonly state: GameState<W>;
  readonly rng: Rng;
  step(steps: Step | Step[]): StepOutcome;
}

/** One state check (§4). Returns true if it changed anything. */
export type StateCheck<W = unknown> = (ctx: CheckContext<W>) => boolean;

export interface ActionContext<W = unknown> {
  readonly state: GameState<W>;
  readonly rng: Rng;
  /** Pays a cost or applies an immediate change as a step (§2 step 2). */
  step(steps: Step | Step[]): StepOutcome;
  /** Puts an item on the stack (§2 step 3). */
  announce(item: NewItem): StackItem;
  newId(prefix: string): string;
}

export interface ActionDef<W = unknown> {
  /** Legal responses for the side while a response window is open (`state.prompt`). */
  respond?(state: GameState<W>, side: SideId, prompt: Prompt): Action[];
  /** Every legal instance of this action for the side right now. */
  list(state: GameState<W>, side: SideId): Action[];
  perform(ctx: ActionContext<W>, action: Action): void;
}

export interface PhaseContext<W = unknown> {
  readonly state: GameState<W>;
  readonly rng: Rng;
  step(steps: Step | Step[]): StepOutcome;
  announce(item: NewItem): StackItem;
  newId(prefix: string): string;
}

export interface PhaseDef<W = unknown> {
  id: string;
  /** Repeat this phase once per side, in side order, with that side active. */
  perSide?: boolean;
  /** Make this specific side active (ignored with perSide). */
  side?: SideId;
  /** Wait for the active side's actions until it ends the turn. */
  interactive?: boolean;
  /** Runs on entering the phase; usually announces rules items (§8). */
  enter?(ctx: PhaseContext<W>): void;
}

export interface Limits {
  maxStepsPerAction: number;
  maxInterruptDepth: number;
  /** No responses are legal once the stack is this deep (§5.2). */
  maxStackDepth: number;
}

/** Which response windows open (§5.1). None by default, so games without reactions never pause. */
export interface WindowConfig {
  itemAnnounced?: boolean;
  itemTop?: boolean;
  /** Every phase, or only the listed phase ids. */
  phaseEnd?: boolean | string[];
}

export interface GameRules<W = unknown> {
  /** The phases of one round, in order (§8). At least one must be interactive. */
  round: PhaseDef<W>[];
  ops: Record<string, OpHandler<W>>;
  steps: Record<string, StepHandler<W>>;
  actions?: Record<string, ActionDef<W>>;
  /** Every modifier, interrupt and trigger active in this state. */
  listeners?(state: GameState<W>): Listener<W>[];
  /** Run in order after every step; the outcome check runs after them (§4). */
  stateChecks?: StateCheck<W>[];
  outcome?(state: GameState<W>): Outcome | null;
  /** Called after an item resolves, e.g. to move its card to discard (§3 step 4). */
  onItemResolved?(ctx: PhaseContext<W>, item: StackItem): void;
  limits?: Partial<Limits>;
  windows?: WindowConfig;
  /**
   * Hides what `viewer` may not see in a copy of the world (#53). `viewer` is
   * a side, or null for a spectator who sees only public information.
   */
  view?(world: W, viewer: SideId | null, state: GameState<W>): void;
  /** Redacts an event for a viewer, or returns null to withhold it. */
  redact?(event: GameEvent, viewer: SideId | null, state: GameState<W>): GameEvent | null;
}

export interface GameSetup<W> {
  seed: string | number;
  sides: Side[];
  world: W;
}

export type ApplyError =
  | { code: 'illegal-action'; message: string }
  | { code: 'game-over'; message: string }
  | { code: 'resolution-limit'; message: string; trace: string[] }
  | { code: 'invalid-content'; message: string };

export type ApplyResult<W> =
  | { ok: true; state: GameState<W>; events: GameEvent[] }
  | { ok: false; error: ApplyError };
