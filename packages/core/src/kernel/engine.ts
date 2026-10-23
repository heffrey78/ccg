/**
 * The resolution kernel: `createGame`, `apply` and `legalActions`.
 *
 * Implements docs/design/resolution-order.md (§n references point there).
 * Each call works on a private copy of the state, so a rejected action leaves
 * the caller's state untouched (§2).
 *
 * Not yet implemented: per-viewer views (#53).
 */
import { clonePlain } from '../clone.js';
import { canonicalJson, hashState } from '../hash.js';
import { Rng, seedRng } from '../rng.js';
import { controllerRanker, sortListeners } from './order.js';
import { ContentError, resolveParams } from './params.js';
import type {
  Action,
  ActionContext,
  ApplyResult,
  Cause,
  CheckContext,
  Effect,
  EffectContext,
  EventInput,
  GameEvent,
  GameRules,
  GameSetup,
  GameState,
  Interrupt,
  Limits,
  Listener,
  NewItem,
  Modifier,
  PhaseContext,
  PhaseDef,
  Prompt,
  SideId,
  StackItem,
  Step,
  StepOutcome,
  Trigger,
  WindowTiming,
} from './types.js';

const DEFAULT_LIMITS: Limits = {
  maxStepsPerAction: 10_000,
  maxInterruptDepth: 16,
  maxStackDepth: 8,
};

/** The built-in action that ends the active side's interactive phase. */
export const END_TURN = 'endTurn';
/** The built-in action that declines to respond in an open window (§5.2). */
export const PASS = 'pass';

export interface ScheduledPhase<W> {
  def: PhaseDef<W>;
  activeSide: SideId | null;
}

/** The round's phases expanded for these sides (§8). */
export function schedule<W>(rules: GameRules<W>, sides: readonly { id: SideId }[]): ScheduledPhase<W>[] {
  const out: ScheduledPhase<W>[] = [];
  for (const def of rules.round) {
    if (def.perSide) {
      for (const side of sides) out.push({ def, activeSide: side.id });
    } else {
      out.push({ def, activeSide: def.side ?? null });
    }
  }
  return out;
}

/** Builds the initial state and runs the game up to the first decision. */
export function createGame<W>(rules: GameRules<W>, setup: GameSetup<W>): ApplyResult<W> {
  try {
    validateRules(rules, setup.sides.map((s) => s.id));
  } catch (error) {
    if (error instanceof ContentError) return { ok: false, error: { code: 'invalid-content', message: error.message } };
    throw error;
  }
  const state: GameState<W> = {
    format: 1,
    seq: 0,
    actionCount: 0,
    rng: seedRng(setup.seed),
    secret: hashState({ seed: setup.seed, purpose: 'opaque ids' }),
    sides: clonePlain(setup.sides),
    turn: { round: 0, slot: -1, phase: '', activeSide: null },
    stack: [],
    prompt: null,
    outcome: null,
    world: clonePlain(setup.world),
  };
  return run(state, rules, (r) => {
    // Settle derived values (statics, clamps) before play begins.
    r.settle();
    r.advancePhase();
  });
}

/** Applies one action. The input state is never modified. */
export function apply<W>(rules: GameRules<W>, state: GameState<W>, action: Action): ApplyResult<W> {
  if (state.outcome) {
    return { ok: false, error: { code: 'game-over', message: 'the game has ended' } };
  }
  const wanted = canonicalJson(action);
  if (!legalActions(rules, state, action.side).some((legal) => canonicalJson(legal) === wanted)) {
    return {
      ok: false,
      error: { code: 'illegal-action', message: `illegal action ${wanted}` },
    };
  }

  const working = clonePlain(state);
  working.actionCount += 1;
  return run(working, rules, (r) => r.perform(action));
}

/** Every action the side may take now (§2 step 1). */
export function legalActions<W>(rules: GameRules<W>, state: GameState<W>, side: SideId): Action[] {
  if (state.outcome) return [];
  if (state.prompt) {
    if (state.prompt.side !== side) return [];
    return [...responses(rules, state, side, state.prompt), { type: PASS, side }];
  }
  if (state.stack.length > 0) return [];
  const current = schedule(rules, state.sides)[state.turn.slot];
  if (!current?.def.interactive || current.activeSide !== side) return [];

  const out: Action[] = [];
  for (const def of Object.values(rules.actions ?? {})) out.push(...def.list(state, side));
  out.push({ type: END_TURN, side });
  return out;
}

/** The responses a side may make in the open window (§5.2). */
function responses<W>(rules: GameRules<W>, state: GameState<W>, side: SideId, prompt: Prompt): Action[] {
  const maxDepth = rules.limits?.maxStackDepth ?? DEFAULT_LIMITS.maxStackDepth;
  if (state.stack.length >= maxDepth) return [];
  return Object.values(rules.actions ?? {}).flatMap((def) => def.respond?.(state, side, prompt) ?? []);
}

function run<W>(state: GameState<W>, rules: GameRules<W>, start: (r: Resolver<W>) => void): ApplyResult<W> {
  const resolver = new Resolver(state, rules);
  try {
    start(resolver);
    resolver.drain();
  } catch (error) {
    if (error instanceof LimitError) {
      return { ok: false, error: { code: 'resolution-limit', message: error.message, trace: error.trace } };
    }
    if (error instanceof ContentError) {
      return { ok: false, error: { code: 'invalid-content', message: error.message } };
    }
    if (!(error instanceof GameEndedSignal)) throw error;
  }
  return { ok: true, state: resolver.finish(), events: resolver.events };
}

function validateRules<W>(rules: GameRules<W>, sideIds: SideId[]): void {
  if (rules.round.length === 0) throw new ContentError('the round has no phases');
  if (!rules.round.some((p) => p.interactive)) {
    throw new ContentError('the round needs at least one interactive phase');
  }
  for (const phase of rules.round) {
    if (phase.interactive && !phase.perSide && phase.side === undefined) {
      throw new ContentError(`interactive phase '${phase.id}' needs perSide or side`);
    }
    if (phase.side !== undefined && !sideIds.includes(phase.side)) {
      throw new ContentError(`phase '${phase.id}' names unknown side '${phase.side}'`);
    }
  }
}

class LimitError extends Error {
  constructor(
    message: string,
    readonly trace: string[],
  ) {
    super(message);
  }
}

/** Unwinds resolution once a win/lose condition is met (§4 step 5). */
class GameEndedSignal extends Error {}

interface Collected<W> {
  listener: Trigger<W>;
  event: GameEvent;
  eventIndex: number;
}

class Resolver<W> {
  readonly events: GameEvent[] = [];
  readonly rng: Rng;
  private readonly limits: Limits;
  private collected: Collected<W>[] = [];
  private cause: Omit<Cause, 'action'> = {};
  private steps = 0;
  private interruptDepth = 0;
  private inStateChecks = false;
  private readonly firings = new Map<string, number>();

  constructor(
    private readonly state: GameState<W>,
    private readonly rules: GameRules<W>,
  ) {
    this.rng = new Rng(state.rng);
    this.limits = { ...DEFAULT_LIMITS, ...rules.limits };
  }

  finish(): GameState<W> {
    this.state.rng = this.rng.state;
    return this.state;
  }

  // ---- actions and the main loop (§2) ----

  perform(action: Action): void {
    if (action.type === PASS) {
      this.pass(action.side);
      return;
    }
    // A response (or any action) answers the prompt; the new item gets its own window.
    this.state.prompt = null;
    if (action.type === END_TURN) {
      this.emit({ type: 'TurnEnded', side: action.side });
      if (this.phaseEndWindow()) this.state.turn.ending = true;
      else this.advancePhase();
      return;
    }
    const def = this.rules.actions?.[action.type];
    if (!def) throw new ContentError(`no action definition for '${action.type}'`);
    const ctx: ActionContext<W> = {
      state: this.state,
      rng: this.rng,
      step: (steps) => this.step(steps),
      announce: (item) => this.announce(item),
      newId: (prefix) => this.newId(prefix),
    };
    def.perform(ctx, action);
  }

  /** Resolves until the game needs a decision or ends. */
  drain(): void {
    for (;;) {
      if (this.state.prompt) return;
      const top = this.state.stack.at(-1);
      if (top) {
        if (this.itemWindows() && !top.windowDone) {
          top.windowDone = true;
          const timing = top.announced ? 'itemTop' : 'itemAnnounced';
          top.announced = true;
          if (this.openWindow(timing, top)) return;
          continue;
        }
        this.resolveTop();
        continue;
      }
      if (this.collected.length > 0) {
        this.flushTriggers();
        continue;
      }
      const turn = this.state.turn;
      if (this.currentPhase()?.def.interactive && !turn.ending) return;
      if (this.phaseEndWindow() && !turn.endWindowDone) {
        turn.endWindowDone = true;
        if (this.openWindow('phaseEnd', null)) return;
        continue;
      }
      this.advancePhase();
    }
  }

  // ---- response windows and priority (§5) ----

  private itemWindows(): boolean {
    const w = this.rules.windows;
    return Boolean(w?.itemAnnounced || w?.itemTop);
  }

  private phaseEndWindow(): boolean {
    const setting = this.rules.windows?.phaseEnd;
    return Array.isArray(setting) ? setting.includes(this.state.turn.phase) : Boolean(setting);
  }

  /**
   * Opens a window if the game enables this timing point. Priority goes to
   * sides in turn order starting after the item's controller (or after the
   * active side); sides with nothing to play pass automatically. Returns true
   * if the game is now waiting on a prompt.
   */
  private openWindow(window: WindowTiming, item: StackItem | null): boolean {
    if (!this.rules.windows?.[window]) return false;
    const sides = this.state.sides.map((s) => s.id);
    const after = item ? item.controller : this.state.turn.activeSide;
    const start = after === null ? 0 : (sides.indexOf(after) + 1) % sides.length;
    const order = [...sides.slice(start), ...sides.slice(0, start)];
    this.emit({ type: 'WindowOpened', window, item: item?.id ?? null });
    return this.offerPriority({ kind: 'priority', window, item: item?.id ?? null, side: order[0] as SideId, order, passed: [] });
  }

  /** Gives priority to the next side in order that can respond; closes the window if none can. */
  private offerPriority(prompt: Prompt): boolean {
    for (const side of prompt.order) {
      if (prompt.passed.includes(side)) continue;
      const candidate: Prompt = { ...prompt, side };
      if (responses(this.rules, { ...this.state, prompt: candidate }, side, candidate).length > 0) {
        this.state.prompt = candidate;
        this.emit({ type: 'PriorityGiven', side, window: prompt.window, item: prompt.item });
        return true;
      }
      prompt.passed.push(side);
    }
    this.state.prompt = null;
    this.emit({ type: 'WindowClosed', window: prompt.window, item: prompt.item });
    return false;
  }

  private pass(side: SideId): void {
    const prompt = this.state.prompt as Prompt;
    this.emit({ type: 'Passed', side, window: prompt.window, item: prompt.item });
    this.offerPriority({ ...prompt, passed: [...prompt.passed, side] });
  }

  // ---- phases (§8) ----

  advancePhase(): void {
    this.countStep();
    const slots = schedule(this.rules, this.state.sides);
    const turn = this.state.turn;
    if (turn.slot >= 0) this.emit({ type: 'PhaseEnded', phase: turn.phase, activeSide: turn.activeSide });

    let slot = turn.slot + 1;
    if (slot >= slots.length || turn.round === 0) {
      slot = 0;
      turn.round += 1;
      this.emit({ type: 'RoundStarted', round: turn.round });
    }
    const next = slots[slot] as ScheduledPhase<W>;
    turn.slot = slot;
    turn.phase = next.def.id;
    turn.activeSide = next.activeSide;
    delete turn.ending;
    delete turn.endWindowDone;
    this.emit({ type: 'PhaseStarted', phase: next.def.id, activeSide: next.activeSide, round: turn.round });
    next.def.enter?.(this.phaseContext());
  }

  private currentPhase(): ScheduledPhase<W> | undefined {
    return schedule(this.rules, this.state.sides)[this.state.turn.slot];
  }

  private phaseContext(): PhaseContext<W> {
    return {
      state: this.state,
      rng: this.rng,
      step: (steps) => this.step(steps),
      announce: (item) => this.announce(item),
      newId: (prefix) => this.newId(prefix),
    };
  }

  // ---- the stack (§2, §3) ----

  private announce(input: NewItem): StackItem {
    const item: StackItem = { ...input, id: this.newId('item'), countered: false };
    this.state.stack.push(item);
    this.emit({
      type: 'ItemAnnounced',
      item: item.id,
      kind: item.kind,
      controller: item.controller,
      source: item.source,
    });
    return item;
  }

  private resolveTop(): void {
    const item = this.state.stack.pop() as StackItem;
    // The item below becomes the top again and gets an itemTop window (§5.1).
    const below = this.state.stack.at(-1);
    if (below && this.itemWindows()) below.windowDone = false;
    this.countStep();
    this.withCause({ item: item.id }, () => {
      this.emit({ type: 'ItemResolving', item: item.id });
      if (item.countered) {
        this.emit({ type: 'ItemCountered', item: item.id });
      } else {
        this.runEffects(item);
      }
      this.rules.onItemResolved?.(this.phaseContext(), item);
      this.emit({ type: 'ItemResolved', item: item.id });
    });
    this.flushTriggers();
  }

  private runEffects(item: StackItem, via?: string): void {
    item.effects.forEach((effect, index) => {
      this.withCause(via === undefined ? { item: item.id, effect: index } : { item: item.id, effect: index, via }, () =>
        this.runEffect(item, effect),
      );
    });
  }

  /** Runs one effect of an item: resolve its parameters, run its op, then state checks. */
  private runEffect(item: StackItem, effect: Effect): void {
    const handler = this.rules.ops[effect.op];
    if (!handler) throw new ContentError(`unknown op '${effect.op}'`);
    const { op: _op, ...params } = effect;
    const resolved = resolveParams(params, item.vars);
    const ctx: EffectContext<W> = {
      state: this.state,
      item,
      rng: this.rng,
      step: (steps) => this.step(steps),
      setVar: (name, value) => {
        item.vars[name] = value;
      },
      // Nested effects (e.g. an `if` op's branches) keep the outer effect's cause.
      run: (effects) => {
        for (const nested of effects) this.runEffect(item, nested);
      },
      newId: (prefix) => this.newId(prefix),
    };
    handler(ctx, resolved);
    this.runStateChecks();
  }

  // ---- steps, modifiers and interrupts (§3, §6.1) ----

  private step(input: Step | Step[]): StepOutcome {
    const requested = Array.isArray(input) ? input : [input];
    const modifiers = this.ordered(this.listeners().filter(isModifier).map((listener) => ({ listener, eventIndex: 0 })));
    const pending = requested.flatMap((s) => this.modify(s, modifiers.map((m) => m.listener), new Set()));

    const produced: GameEvent[] = [];
    for (const s of pending) {
      this.countStep();
      const handler = this.rules.steps[s.kind];
      if (!handler) throw new ContentError(`unknown step '${s.kind}'`);
      for (const event of handler(this.state, s)) produced.push(this.emit(event));
    }

    let halted = false;
    const firstIndex = this.events.length - produced.length;
    const interrupts = this.listeners().filter(isInterrupt);
    const matched = this.ordered(
      produced.flatMap((event, i) =>
        interrupts
          .filter((listener) => listener.matches(event, this.state))
          .map((listener) => ({ listener, eventIndex: firstIndex + i, event })),
      ),
    );
    for (const { listener, event } of matched) {
      // An earlier interrupt may have removed this one's source.
      if (!this.listeners().some((l) => l.id === listener.id)) continue;
      if (listener.halt) halted = true;
      this.runInterrupt(listener, event);
    }

    this.runStateChecks();
    return { events: produced, halted };
  }

  /** Passes a step through each matching modifier once, in order (§6.3). */
  private modify(step: Step, modifiers: Modifier<W>[], applied: Set<string>): Step[] {
    for (const modifier of modifiers) {
      if (applied.has(modifier.id) || !modifier.matches(step, this.state)) continue;
      this.track(modifier.id);
      const next = new Set(applied).add(modifier.id);
      return modifier.modify(step, this.state).flatMap((s) => this.modify(s, modifiers, next));
    }
    return [step];
  }

  private runInterrupt(listener: Interrupt<W>, event: GameEvent): void {
    if (++this.interruptDepth > this.limits.maxInterruptDepth) {
      throw new LimitError(`interrupts nested more than ${this.limits.maxInterruptDepth} deep`, this.trace());
    }
    this.track(listener.id);
    const item: StackItem = {
      id: this.newId('int'),
      kind: 'interrupt',
      controller: listener.controller,
      source: listener.source,
      effects: listener.effects,
      vars: { ...listener.vars, event },
      countered: false,
    };
    this.runEffects(item, listener.id);
    this.interruptDepth -= 1;
  }

  // ---- reactive triggers (§6.2) ----

  private flushTriggers(): void {
    if (this.collected.length === 0) return;
    const sorted = this.ordered(this.collected);
    this.collected = [];
    // Push in reverse so the first in order ends up on top and resolves first.
    for (let i = sorted.length - 1; i >= 0; i--) {
      const { listener, event } = sorted[i] as Collected<W>;
      this.track(listener.id);
      this.withCause({ via: listener.id }, () =>
        this.announce({
          kind: 'trigger',
          controller: listener.controller,
          source: listener.source,
          effects: listener.effects,
          vars: { ...listener.vars, event },
        }),
      );
    }
  }

  // ---- state checks (§4) ----

  settle(): void {
    this.runStateChecks();
  }

  private runStateChecks(): void {
    if (this.inStateChecks) return;
    this.inStateChecks = true;
    try {
      const ctx: CheckContext<W> = { state: this.state, rng: this.rng, step: (steps) => this.step(steps) };
      const checks = this.rules.stateChecks ?? [];
      let changed = true;
      while (changed) {
        changed = false;
        for (const check of checks) {
          if (check(ctx)) {
            this.countStep();
            changed = true;
            break;
          }
        }
      }
      this.checkOutcome();
    } finally {
      this.inStateChecks = false;
    }
  }

  private checkOutcome(): void {
    if (this.state.outcome || !this.rules.outcome) return;
    const outcome = this.rules.outcome(this.state);
    if (!outcome) return;
    this.state.outcome = outcome;
    this.state.stack = [];
    this.collected = [];
    this.emit({ type: 'GameEnded', winners: outcome.winners, reason: outcome.reason });
    throw new GameEndedSignal();
  }

  // ---- events and bookkeeping ----

  private emit(input: EventInput): GameEvent {
    const event: GameEvent = { ...input, cause: { action: this.state.actionCount, ...this.cause } };
    const eventIndex = this.events.length;
    this.events.push(event);
    for (const listener of this.listeners()) {
      if (listener.kind === 'trigger' && listener.matches(event, this.state)) {
        this.collected.push({ listener, event, eventIndex });
      }
    }
    return event;
  }

  private listeners(): Listener<W>[] {
    return this.rules.listeners?.(this.state) ?? [];
  }

  private ordered<T extends { listener: Listener<W>; eventIndex: number }>(entries: T[]): T[] {
    const sideOrder = this.state.sides.map((s) => s.id);
    return sortListeners(entries, controllerRanker(sideOrder, this.state.turn.activeSide));
  }

  private withCause(cause: Omit<Cause, 'action'>, fn: () => void): void {
    const saved = this.cause;
    this.cause = { ...saved, ...cause };
    try {
      fn();
    } finally {
      this.cause = saved;
    }
  }

  private newId(prefix: string): string {
    this.state.seq += 1;
    return `${prefix}${this.state.seq}`;
  }

  private countStep(): void {
    if (++this.steps > this.limits.maxStepsPerAction) {
      throw new LimitError(`more than ${this.limits.maxStepsPerAction} steps in one action`, this.trace());
    }
  }

  private track(listenerId: string): void {
    this.firings.set(listenerId, (this.firings.get(listenerId) ?? 0) + 1);
  }

  /** The listeners that fired most, which is where a loop will show up. */
  private trace(): string[] {
    return [...this.firings.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 5)
      .map(([id, count]) => `${id} ×${count}`);
  }
}

function isModifier<W>(listener: Listener<W>): listener is Modifier<W> {
  return listener.kind === 'modifier';
}

function isInterrupt<W>(listener: Listener<W>): listener is Interrupt<W> {
  return listener.kind === 'interrupt';
}
