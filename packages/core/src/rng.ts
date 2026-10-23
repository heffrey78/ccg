/**
 * Seeded, serializable pseudo-random number generator (decision #11).
 *
 * The generator is sfc32: four 32-bit words of state, fast, and good quality
 * for game use. Its state is plain numbers so it can live inside game state,
 * survive JSON round-trips and replay exactly.
 *
 * `Rng` is a mutable cursor for use inside a single resolution step: create it
 * from the state's `RngState`, draw from it, then store `rng.state` back into
 * the next state. The cursor never leaks between steps.
 */

/** Serializable generator state: four unsigned 32-bit integers. */
export type RngState = readonly [number, number, number, number];

const UINT32 = 0x1_0000_0000;

/** Number of outputs discarded after seeding so weak seeds mix fully. */
const WARMUP = 15;

/** Creates generator state from a seed. Equal seeds give equal streams. */
export function seedRng(seed: string | number): RngState {
  const rng = new Rng(hashSeed(String(seed)));
  for (let i = 0; i < WARMUP; i++) rng.nextUint32();
  return rng.state;
}

export class Rng {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(state: RngState) {
    [this.#a, this.#b, this.#c, this.#d] = state;
  }

  /** Current state, for storing back into game state. Always unsigned. */
  get state(): RngState {
    return [this.#a >>> 0, this.#b >>> 0, this.#c >>> 0, this.#d >>> 0];
  }

  /** Next unsigned 32-bit integer. */
  nextUint32(): number {
    const a = this.#a;
    const b = this.#b;
    const c = this.#c;
    const d = this.#d;
    const t = (((a + b) | 0) + d) | 0;
    this.#d = (d + 1) | 0;
    this.#a = b ^ (b >>> 9);
    this.#b = (c + (c << 3)) | 0;
    const r = (c << 21) | (c >>> 11);
    this.#c = (r + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.nextUint32() / UINT32;
  }

  /** Integer in [min, max], both inclusive, without modulo bias. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(${min}, ${max}) needs integers with min <= max`);
    }
    const range = max - min + 1;
    if (range > UINT32) {
      throw new RangeError(`int(${min}, ${max}) spans more than 2^32 values`);
    }
    // Reject draws from the incomplete final block so every value is equally likely.
    const limit = UINT32 - (UINT32 % range);
    let draw = this.nextUint32();
    while (draw >= limit) draw = this.nextUint32();
    return min + (draw % range);
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.float() < probability;
  }

  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() from an empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * An element chosen with probability proportional to its weight. Weights must
   * be finite and non-negative, with a positive total.
   */
  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) {
      const w = weight(item);
      if (!Number.isFinite(w) || w < 0) {
        throw new RangeError(`weightedPick() weight must be finite and >= 0, got ${w}`);
      }
      total += w;
    }
    if (total <= 0) throw new RangeError('weightedPick() needs a positive total weight');

    let target = this.float() * total;
    for (const item of items) {
      target -= weight(item);
      if (target < 0) return item;
    }
    // Floating-point rounding can leave a sliver at the end; give it to the
    // last item with weight.
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as T;
      if (weight(item) > 0) return item;
    }
    throw new Error('unreachable');
  }

  /** A shuffled copy (Fisher-Yates). The input is not modified. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /**
   * Derives an independent sub-stream, e.g. one per enemy or per deck, so that
   * draws in one stream don't shift another. Advances this generator, so
   * forking twice with the same label gives different streams.
   */
  fork(label: string): RngState {
    const [a, b, c, d] = hashSeed(label);
    const rng = new Rng([
      (a ^ this.nextUint32()) >>> 0,
      (b ^ this.nextUint32()) >>> 0,
      (c ^ this.nextUint32()) >>> 0,
      (d ^ this.nextUint32()) >>> 0,
    ]);
    for (let i = 0; i < WARMUP; i++) rng.nextUint32();
    return rng.state;
  }
}

/** cyrb128: hashes a string into four 32-bit words for seeding. */
function hashSeed(text: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
