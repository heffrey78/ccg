/**
 * The meta layer (#9, design spike #32): a deterministic reducer above
 * encounters, shaped like the encounter kernel. A campaign's state changes
 * only through meta actions and encounter results; anything random comes from
 * its own seeded generator. A meta action may launch an encounter, and then
 * the campaign waits for that encounter's result. See docs/design/meta-layer.md.
 */
import { clonePlain } from '../clone.js';
import { hashState } from '../hash.js';
import { Rng, seedRng, type RngState } from '../rng.js';
import type { RunCard } from '../standard.js';

/** What the meta layer asks the encounter layer to play. */
export interface EncounterLaunch {
  /** A qualified encounter id. */
  encounter: string;
  /** Derived from the campaign's generator, so the encounter is reproducible. */
  seed: string;
  /** The player's deck and units' HP going in, by unit definition. */
  deck: RunCard[];
  hp?: Record<string, number>;
  difficulty?: string;
  /** What launched it, for the result to refer back to (e.g. a region). */
  context?: Record<string, unknown>;
}

/** What an encounter hands back. */
export interface EncounterResult {
  won: boolean;
  /** Player units' HP at the end, by unit definition. */
  hp: Record<string, number>;
  rounds: number;
}

export interface MetaEvent {
  type: string;
  [field: string]: unknown;
}

export interface MetaState<M> {
  world: M;
  rng: RngState;
  /** Meta actions taken so far. */
  step: number;
  /** The encounter being played; meta actions wait until its result is in. */
  pending: EncounterLaunch | null;
  outcome: { won: boolean; reason: string } | null;
}

export interface MetaAction {
  type: string;
  [field: string]: unknown;
}

/** What a meta action or result did: its events, and maybe an encounter to play next. */
export interface MetaStep {
  events: MetaEvent[];
  launch?: Omit<EncounterLaunch, 'seed'>;
}

/** A meta module: e.g. a run's node map, or a strategic map. It mutates the draft it is given. */
export interface MetaRules<M, A extends MetaAction = MetaAction> {
  legal(state: MetaState<M>): A[];
  apply(state: MetaState<M>, action: A, rng: Rng): MetaStep | { error: string };
  resolve(state: MetaState<M>, launch: EncounterLaunch, result: EncounterResult, rng: Rng): MetaStep;
  outcome?(state: MetaState<M>): MetaState<M>['outcome'];
}

export type MetaApply<M> = { ok: true; state: MetaState<M>; events: MetaEvent[] } | { ok: false; error: string };

export function startMeta<M>(seed: string | number, world: M): MetaState<M> {
  return { world: clonePlain(world), rng: seedRng(`meta:${String(seed)}`), step: 0, pending: null, outcome: null };
}

/** The next state after `step`: launches get their seed from the campaign's generator. */
function finish<M>(rules: MetaRules<M, MetaAction>, draft: MetaState<M>, rng: Rng, step: MetaStep): MetaApply<M> {
  const events = [...step.events];
  if (step.launch) {
    draft.pending = { ...step.launch, seed: `enc:${rng.int(0, 2 ** 31 - 1)}` };
    events.push({ type: 'EncounterLaunched', encounter: step.launch.encounter });
  }
  draft.rng = rng.state;
  draft.outcome = rules.outcome?.(draft) ?? null;
  return { ok: true, state: draft, events };
}

export function applyMeta<M, A extends MetaAction>(rules: MetaRules<M, A>, state: MetaState<M>, action: A): MetaApply<M> {
  if (state.outcome) return { ok: false, error: 'the campaign is over' };
  if (state.pending) return { ok: false, error: 'an encounter is being played' };
  if (!rules.legal(state).some((a) => hashState(a) === hashState(action))) return { ok: false, error: `'${action.type}' is not legal now` };
  const draft = clonePlain(state);
  const rng = new Rng(draft.rng);
  const step = rules.apply(draft, action, rng);
  if ('error' in step) return { ok: false, error: step.error };
  draft.step++;
  return finish(rules as MetaRules<M, MetaAction>, draft, rng, step);
}

/** Feeds the pending encounter's result back into the campaign. */
export function resolveEncounter<M>(rules: MetaRules<M, MetaAction>, state: MetaState<M>, result: EncounterResult): MetaApply<M> {
  const launch = state.pending;
  if (!launch) return { ok: false, error: 'no encounter is being played' };
  const draft = clonePlain(state);
  draft.pending = null;
  const rng = new Rng(draft.rng);
  const step = rules.resolve(draft, launch, result, rng);
  return finish(rules, draft, rng, step);
}
