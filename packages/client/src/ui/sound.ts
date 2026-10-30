/**
 * Sound (#155, #158). Each game event that makes a noise maps to a cue, and each
 * cue has a small synthesized recipe, so every game has sound without any audio
 * files; a game's theme can replace any of them (#159). Sound follows the events playback shows, so it reveals nothing hidden
 * from the player. Framework-free, with an injectable AudioContext for tests,
 * and it never throws: a broken audio stack must not stop the game.
 */
import { SOUND_CUES, type SoundCue } from '@ccg/content';
import type { GameEvent } from '@ccg/core';

export const CUES = SOUND_CUES;
export type Cue = SoundCue;

export const EVENT_CUES: Record<string, Cue> = {
  ItemAnnounced: 'card',
  CardRevealed: 'card',
  PermanentEntered: 'card',
  PermanentRevealed: 'card',
  UnitEnteredTile: 'move',
  UnitCollided: 'hit',
  DamageDealt: 'hit',
  AttackBlocked: 'block',
  BlockGained: 'block',
  Healed: 'heal',
  StatusChanged: 'status',
  UnitConverted: 'status',
  UnitDied: 'death',
  UnitFell: 'death',
  UnitSpawned: 'spawn',
};

export const cueOf = (event: GameEvent): Cue | null => EVENT_CUES[event.type] ?? null;

/** The most a step sounds at Instant speed, and the gap between its cues. */
const DIGEST_LIMIT = 3;
const DIGEST_GAP = 0.09;

/** What a whole step sounds like when it isn't played out: its first few different cues. */
export function digest(events: GameEvent[]): Cue[] {
  const cues = new Set<Cue>();
  for (const event of events) {
    const cue = cueOf(event);
    if (cue) cues.add(cue);
    if (cues.size === DIGEST_LIMIT) break;
  }
  return [...cues];
}

/** One voice of a cue: a pitch sweep, or filtered noise. Times are seconds; gain is before the volume. */
interface Tone {
  wave: OscillatorType | 'noise';
  from: number;
  to?: number;
  at?: number;
  length: number;
  gain: number;
}

const notes = (wave: OscillatorType, pitches: number[], step: number, gain: number): Tone[] =>
  pitches.map((from, i) => ({ wave, from, at: i * step, length: step * 1.6, gain }));

const RECIPES: Record<Cue, Tone[]> = {
  card: [{ wave: 'triangle', from: 520, to: 780, length: 0.09, gain: 0.5 }],
  move: [{ wave: 'sine', from: 190, to: 130, length: 0.07, gain: 0.45 }],
  hit: [
    { wave: 'noise', from: 1800, length: 0.1, gain: 0.5 },
    { wave: 'square', from: 150, to: 60, length: 0.12, gain: 0.3 },
  ],
  block: [
    { wave: 'noise', from: 5000, length: 0.05, gain: 0.3 },
    { wave: 'triangle', from: 950, to: 620, length: 0.1, gain: 0.4 },
  ],
  heal: notes('sine', [523, 659, 784], 0.07, 0.4),
  status: [{ wave: 'sine', from: 680, to: 540, length: 0.13, gain: 0.35 }],
  death: [{ wave: 'sawtooth', from: 220, to: 45, length: 0.38, gain: 0.35 }],
  spawn: [{ wave: 'triangle', from: 280, to: 640, length: 0.16, gain: 0.4 }],
  win: notes('triangle', [523, 659, 784, 1047], 0.11, 0.45),
  lose: notes('triangle', [392, 330, 262, 196], 0.15, 0.45),
};

/** The Web Audio the player uses, so tests can stand in for it. */
export type CreateContext = () => AudioContext | null;

const browserContext: CreateContext = () => (typeof AudioContext === 'undefined' ? null : new AudioContext());
const browserFetch = async (url: string) => (await fetch(url)).arrayBuffer();

export class Sound {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #noise: AudioBuffer | null = null;
  #volume = 0;
  #hidden = false;
  #files: Partial<Record<Cue, string>> = {};
  #buffers: Partial<Record<Cue, AudioBuffer>> = {};
  #wanted = false;

  constructor(
    private readonly createContext: CreateContext = browserContext,
    private readonly fetchFile: (url: string) => Promise<ArrayBuffer> = browserFetch,
  ) {}

  /** The game's own sounds by cue, loaded once there's audio; others keep their built-in sound. */
  setSounds(files: Partial<Record<Cue, string>>): void {
    this.#files = files;
    this.#buffers = {};
    this.#wanted = true;
    if (this.#context) this.#load(this.#context);
  }

  /** 0 to 1; 0 makes no sound and needs no audio at all. */
  setVolume(volume: number): void {
    this.#volume = volume;
    if (this.#master) this.#master.gain.value = volume;
  }

  /** Plays a cue now, or a little later. Dropped while hidden or muted, or until audio is allowed. */
  play(cue: Cue, delay = 0): void {
    if (this.#volume <= 0 || this.#hidden) return;
    try {
      const context = this.#ready();
      if (!context) return;
      if (context.state !== 'running') {
        // Sounds scheduled now would all fire together once it starts.
        void context.resume()?.catch(() => {});
        return;
      }
      const buffer = this.#buffers[cue];
      if (buffer) this.#playBuffer(context, buffer, delay);
      else for (const tone of RECIPES[cue]) this.#schedule(context, tone, delay);
    } catch {
      // No sound is better than no game.
    }
  }

  /** Plays a step's digest, its cues just apart. */
  playDigest(cues: Cue[]): void {
    cues.forEach((cue, i) => this.play(cue, i * DIGEST_GAP));
  }

  /** Stops making sound while the app can't be seen (#163 also calls this from Android's background signal). */
  setHidden(hidden: boolean): void {
    this.#hidden = hidden;
    const context = this.#context;
    if (!context) return;
    try {
      void (hidden ? context.suspend() : context.resume())?.catch(() => {});
    } catch {
      // As in play.
    }
  }

  /** Audio starts only after a gesture, and stops while the page is hidden. Returns how to detach. */
  attach(target: Document): () => void {
    const unlock = () => {
      if (this.#volume <= 0 || this.#hidden) return;
      try {
        void this.#ready()?.resume()?.catch(() => {});
      } catch {
        // As in play.
      }
    };
    const visibility = () => this.setHidden(target.hidden);
    const gestures = ['pointerdown', 'keydown'] as const;
    for (const gesture of gestures) target.addEventListener(gesture, unlock);
    target.addEventListener('visibilitychange', visibility);
    return () => {
      for (const gesture of gestures) target.removeEventListener(gesture, unlock);
      target.removeEventListener('visibilitychange', visibility);
    };
  }

  #ready(): AudioContext | null {
    if (this.#context) return this.#context;
    const context = this.createContext();
    if (!context) return null;
    this.#master = context.createGain();
    this.#master.gain.value = this.#volume;
    this.#master.connect(context.destination);
    this.#context = context;
    if (this.#wanted) this.#load(context);
    return context;
  }

  /** Decodes the game's sounds. One that won't load keeps the built-in sound. */
  #load(context: AudioContext): void {
    this.#wanted = false;
    const files = this.#files;
    for (const [cue, url] of Object.entries(files) as [Cue, string][]) {
      void this.fetchFile(url)
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => {
          // A different game may have started while this one loaded.
          if (this.#files === files) this.#buffers[cue] = buffer;
        })
        .catch((e: unknown) => console.warn(`Sound for '${cue}' didn't load, using the built-in sound.`, e));
    }
  }

  #playBuffer(context: AudioContext, buffer: AudioBuffer, delay: number): void {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#master as GainNode);
    source.start(context.currentTime + delay);
  }

  #schedule(context: AudioContext, tone: Tone, delay: number): void {
    const start = context.currentTime + delay + (tone.at ?? 0);
    const end = start + tone.length;
    const gain = context.createGain();
    gain.gain.setValueAtTime(tone.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    gain.connect(this.#master as GainNode);
    const source = tone.wave === 'noise' ? this.#noiseSource(context, tone, gain) : this.#oscillator(context, tone, gain, start, end);
    source.start(start);
    source.stop(end);
  }

  #oscillator(context: AudioContext, tone: Tone, gain: GainNode, start: number, end: number): AudioScheduledSourceNode {
    const oscillator = context.createOscillator();
    oscillator.type = tone.wave as OscillatorType;
    oscillator.frequency.setValueAtTime(tone.from, start);
    if (tone.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
    oscillator.connect(gain);
    return oscillator;
  }

  #noiseSource(context: AudioContext, tone: Tone, gain: GainNode): AudioScheduledSourceNode {
    if (!this.#noise) {
      this.#noise = context.createBuffer(1, context.sampleRate / 2, context.sampleRate);
      const samples = this.#noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = this.#noise;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = tone.from;
    source.connect(filter);
    filter.connect(gain);
    return source;
  }
}
