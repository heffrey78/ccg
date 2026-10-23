/**
 * Event-driven animation (#29). After each action the engine returns the new
 * view and the events that led to it. Playback steps through the visible
 * events one beat at a time; the board draws units as they were before the
 * action with the events so far applied, then the final view once playback
 * ends or is skipped. Framework-free, with an injectable timer for tests.
 */
import type { GameEvent } from '@ccg/core';
import type { UnitView } from './world.js';

/** Beat length at 1x speed, by event type. Events not listed are not animated. */
export const BEAT_MS: Record<string, number> = {
  ItemAnnounced: 450,
  CardRevealed: 400,
  IntentDeclared: 120,
  UnitEnteredTile: 220,
  UnitTurned: 80,
  UnitCollided: 200,
  AttackBlocked: 320,
  DamageDealt: 380,
  BlockGained: 280,
  BlockLost: 120,
  Healed: 320,
  StatusChanged: 260,
  StatusRemoved: 160,
  UnitSpawned: 260,
  UnitFell: 350,
  UnitDied: 420,
  PermanentEntered: 280,
  PermanentRevealed: 380,
};

export interface Beat {
  event: GameEvent;
  /** Milliseconds at the chosen speed. */
  duration: number;
}

/** The animated beats for some events at a speed multiplier; speed 0 means no animation. */
export function beats(events: GameEvent[], speed: number): Beat[] {
  if (!(speed > 0)) return [];
  return events.flatMap((event) => {
    const ms = BEAT_MS[event.type];
    return ms === undefined ? [] : [{ event, duration: ms / speed }];
  });
}

export type ShownUnit = UnitView & { dying?: boolean };

/**
 * Units as they stand after `events`, starting from the previous view.
 * Units that newly come into view (spawned, or out of fog) take their final
 * state; nothing is invented that the final view does not show.
 */
export function unitsAfter(start: Record<string, UnitView>, events: GameEvent[], final: Record<string, UnitView>): Record<string, ShownUnit> {
  const units: Record<string, ShownUnit> = structuredClone(start);
  for (const e of events) {
    const id = typeof e.unit === 'string' ? e.unit : null;
    if (e.type === 'UnitSpawned' && id && final[id]) {
      units[id] = { ...structuredClone(final[id]), pos: e.pos as string };
      continue;
    }
    const u = id ? units[id] : undefined;
    if (!u) continue;
    switch (e.type) {
      case 'UnitEnteredTile':
        u.pos = e.pos as string;
        break;
      case 'UnitTurned':
        u.facing = e.facing as string;
        break;
      case 'DamageDealt':
        u.hp -= e.amount as number;
        break;
      case 'UnitFell':
        u.hp = 0;
        break;
      case 'Healed':
        u.hp = Math.min(u.maxHp, u.hp + (e.amount as number));
        break;
      case 'BlockGained':
      case 'BlockLost':
        u.block = e.value as number;
        break;
      case 'StatusChanged':
        u.statuses[e.status as string] = e.stacks as number;
        break;
      case 'StatusRemoved':
        delete u.statuses[e.status as string];
        break;
      case 'UnitDied':
        u.dying = true;
        break;
    }
  }
  return units;
}

export interface PlaybackState {
  beats: Beat[];
  /** Beats started so far; `beats[shown - 1]` is the one playing. */
  shown: number;
  done: boolean;
}

export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class Playback {
  #state: PlaybackState = { beats: [], shown: 0, done: true };
  #handle: unknown = null;

  constructor(
    private readonly onChange: (state: PlaybackState) => void,
    private readonly timer: Timer = realTimer,
  ) {}

  get state(): PlaybackState {
    return this.#state;
  }

  /** Starts playing these events, cutting off anything still playing. */
  play(events: GameEvent[], speed: number): void {
    this.#cancel();
    const list = beats(events, speed);
    this.#set({ beats: list, shown: 0, done: list.length === 0 });
    if (list.length > 0) this.#advance();
  }

  /** Jumps to the end. */
  skip(): void {
    if (this.#state.done) return;
    this.#cancel();
    this.#set({ ...this.#state, shown: this.#state.beats.length, done: true });
  }

  dispose(): void {
    this.#cancel();
  }

  #advance(): void {
    const { beats: list, shown } = this.#state;
    if (shown >= list.length) {
      this.#handle = null;
      this.#set({ ...this.#state, done: true });
      return;
    }
    this.#set({ ...this.#state, shown: shown + 1 });
    this.#handle = this.timer.set(() => this.#advance(), (list[shown] as Beat).duration);
  }

  #cancel(): void {
    if (this.#handle !== null) this.timer.clear(this.#handle);
    this.#handle = null;
  }

  #set(state: PlaybackState): void {
    this.#state = state;
    this.onChange(state);
  }
}
