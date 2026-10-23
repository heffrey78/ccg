/**
 * Replays and save snapshots (#20). Because the core is deterministic
 * (decision #11), a game is fully described by its setup plus the actions
 * taken, and replaying them reproduces every state exactly.
 */
import { clonePlain } from './clone.js';
import { canonicalJson, hashState } from './hash.js';
import { apply, createGame } from './kernel/engine.js';
import type { Action, ApplyError, ApplyResult, GameRules, GameSetup, GameState } from './kernel/types.js';
import { ENGINE_API_VERSION, isEngineCompatible } from './version.js';

export const REPLAY_FORMAT = 1;
export const SNAPSHOT_FORMAT = 1;

/** Package id → version, recorded so a replay or save can name what it needs. */
export type PackageVersions = Record<string, string>;

export interface ReplayLog<W> {
  format: typeof REPLAY_FORMAT;
  engineApi: string;
  packages: PackageVersions;
  setup: GameSetup<W>;
  actions: Action[];
}

export interface Snapshot<W> {
  format: typeof SNAPSHOT_FORMAT;
  engineApi: string;
  packages: PackageVersions;
  state: GameState<W>;
}

export type ReplayError = ApplyError | { code: 'incompatible'; message: string };

export type ReplayResult<W> =
  | { ok: true; state: GameState<W>; hashes: string[] }
  /** `at` is the index of the failing action, or -1 if setup itself failed. */
  | { ok: false; error: ReplayError; at: number };

/**
 * Re-runs a replay log. `hashes[0]` is the state after setup and `hashes[i + 1]`
 * the state after action i, so two runs can be compared step by step.
 */
export function replay<W>(rules: GameRules<W>, log: ReplayLog<W>): ReplayResult<W> {
  const incompatible = checkHeader(log.format, REPLAY_FORMAT, log.engineApi);
  if (incompatible) return { ok: false, error: incompatible, at: -1 };

  const start = createGame(rules, log.setup);
  if (!start.ok) return { ok: false, error: start.error, at: -1 };
  let state = start.state;
  const hashes = [hashState(state)];
  for (const [i, action] of log.actions.entries()) {
    const result = apply(rules, state, action);
    if (!result.ok) return { ok: false, error: result.error, at: i };
    state = result.state;
    hashes.push(hashState(state));
  }
  return { ok: true, state, hashes };
}

/** A running game that records its replay log as it goes. */
export class Session<W> {
  #state: GameState<W>;
  readonly #log: ReplayLog<W>;

  private constructor(
    readonly rules: GameRules<W>,
    state: GameState<W>,
    log: ReplayLog<W>,
  ) {
    this.#state = state;
    this.#log = log;
  }

  static start<W>(
    rules: GameRules<W>,
    setup: GameSetup<W>,
    packages: PackageVersions = {},
  ): { ok: true; session: Session<W> } | { ok: false; error: ApplyError } {
    const result = createGame(rules, setup);
    if (!result.ok) return result;
    const log: ReplayLog<W> = {
      format: REPLAY_FORMAT,
      engineApi: ENGINE_API_VERSION,
      packages: { ...packages },
      setup: clonePlain(setup),
      actions: [],
    };
    return { ok: true, session: new Session(rules, result.state, log) };
  }

  get state(): GameState<W> {
    return this.#state;
  }

  /** A copy of the replay log so far. */
  get log(): ReplayLog<W> {
    return { ...this.#log, actions: this.#log.actions.slice() };
  }

  /** Applies an action; on success it becomes the current state and is logged. */
  apply(action: Action): ApplyResult<W> {
    const result = apply(this.rules, this.#state, action);
    if (result.ok) {
      this.#state = result.state;
      this.#log.actions.push(action);
    }
    return result;
  }

  /**
   * The same game continuing under new rules, e.g. after content edits in a
   * playtest (#42). State and log carry over; later actions use the new rules.
   */
  rebind(rules: GameRules<W>): Session<W> {
    return new Session(rules, this.#state, { ...this.#log, actions: this.#log.actions.slice() });
  }

  snapshot(): Snapshot<W> {
    return {
      format: SNAPSHOT_FORMAT,
      engineApi: ENGINE_API_VERSION,
      packages: { ...this.#log.packages },
      state: this.#state,
    };
  }
}

/** Canonical JSON text for a snapshot: stable bytes for the same state. */
export function serializeSnapshot<W>(snapshot: Snapshot<W>): string {
  return canonicalJson(snapshot);
}

export function parseSnapshot<W>(
  text: string,
): { ok: true; snapshot: Snapshot<W> } | { ok: false; error: { code: 'incompatible' | 'malformed'; message: string } } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: { code: 'malformed', message: `invalid JSON: ${(error as Error).message}` } };
  }
  const snap = value as Partial<Snapshot<W>> | null;
  if (typeof snap !== 'object' || snap === null || typeof snap.engineApi !== 'string' || !isRecord(snap.state)) {
    return { ok: false, error: { code: 'malformed', message: 'not a snapshot' } };
  }
  const incompatible = checkHeader(snap.format, SNAPSHOT_FORMAT, snap.engineApi);
  if (incompatible) return { ok: false, error: incompatible };
  if (snap.state.format !== 1) {
    return { ok: false, error: { code: 'incompatible', message: `unsupported state format ${String(snap.state.format)}` } };
  }
  return { ok: true, snapshot: snap as Snapshot<W> };
}

function checkHeader(
  format: unknown,
  expected: number,
  engineApi: string,
): { code: 'incompatible'; message: string } | null {
  if (format !== expected) return { code: 'incompatible', message: `unsupported format ${String(format)}` };
  if (!isEngineCompatible(engineApi)) {
    return {
      code: 'incompatible',
      message: `written by engine API ${engineApi}, which this engine (${ENGINE_API_VERSION}) cannot read`,
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
