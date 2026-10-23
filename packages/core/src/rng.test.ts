import { describe, expect, it } from 'vitest';
import { Rng, seedRng, type RngState } from './rng.js';

describe('seedRng', () => {
  // Golden values pin the algorithm: changing them breaks every saved game and
  // replay, so a failure here needs a format migration, not a new snapshot.
  it('produces the pinned state and sequence for a known seed', () => {
    const state = seedRng('ccg');
    expect(state).toEqual([1962222126, 2377644401, 2814680421, 1930210989]);
    const rng = new Rng(state);
    expect(Array.from({ length: 5 }, () => rng.nextUint32())).toEqual([
      1975110220, 3873921480, 2391606479, 36945675, 1666281438,
    ]);
  });

  it('pins int() and shuffle() output', () => {
    const dice = new Rng(seedRng(42));
    expect(Array.from({ length: 10 }, () => dice.int(1, 6))).toEqual([6, 5, 6, 3, 5, 1, 1, 1, 5, 1]);
    const deck = new Rng(seedRng('deck'));
    expect(deck.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([2, 8, 7, 6, 9, 1, 3, 5, 0, 4]);
  });

  it('gives equal streams for equal seeds and different streams otherwise', () => {
    const draw = (state: RngState) => {
      const rng = new Rng(state);
      return Array.from({ length: 8 }, () => rng.nextUint32());
    };
    expect(draw(seedRng('a'))).toEqual(draw(seedRng('a')));
    expect(draw(seedRng('a'))).not.toEqual(draw(seedRng('b')));
    expect(draw(seedRng(1))).toEqual(draw(seedRng('1')));
  });

  it('keeps state as unsigned 32-bit integers', () => {
    const rng = new Rng(seedRng('unsigned'));
    for (let i = 0; i < 100; i++) {
      rng.nextUint32();
      for (const word of rng.state) {
        expect(Number.isInteger(word) && word >= 0 && word < 2 ** 32).toBe(true);
      }
    }
  });
});

describe('Rng serialization', () => {
  it('continues identically after a JSON round-trip of its state', () => {
    const original = new Rng(seedRng('save'));
    for (let i = 0; i < 37; i++) original.nextUint32();

    const restored = new Rng(JSON.parse(JSON.stringify(original.state)) as RngState);
    const a = Array.from({ length: 50 }, () => original.int(0, 1000));
    const b = Array.from({ length: 50 }, () => restored.int(0, 1000));
    expect(b).toEqual(a);
    expect(restored.state).toEqual(original.state);
  });
});

describe('Rng.int', () => {
  it('stays within inclusive bounds, including negative and single-value ranges', () => {
    const rng = new Rng(seedRng('bounds'));
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
    }
    expect(rng.int(7, 7)).toBe(7);
  });

  it('rejects invalid ranges', () => {
    const rng = new Rng(seedRng('invalid'));
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(0, 1.5)).toThrow(RangeError);
    expect(() => rng.int(0, 2 ** 32)).toThrow(RangeError);
  });

  it('is roughly uniform', () => {
    const rng = new Rng(seedRng('uniform'));
    const draws = 100_000;
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < draws; i++) {
      const n = rng.int(0, 9);
      counts[n] = (counts[n] ?? 0) + 1;
    }
    for (const count of counts) {
      expect(Math.abs(count - draws / 10)).toBeLessThan((draws / 10) * 0.05);
    }
  });
});

describe('Rng.shuffle', () => {
  it('returns a permutation and leaves the input untouched', () => {
    const rng = new Rng(seedRng('perm'));
    const input = Object.freeze([1, 2, 3, 4, 5, 6]);
    const out = rng.shuffle(input);
    expect([...out].sort()).toEqual([...input]);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('produces all permutations of three items about equally often', () => {
    const rng = new Rng(seedRng('perms'));
    const runs = 60_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      const key = rng.shuffle(['a', 'b', 'c']).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) {
      expect(Math.abs(count - runs / 6)).toBeLessThan((runs / 6) * 0.05);
    }
  });

  it('handles empty and single-item arrays', () => {
    const rng = new Rng(seedRng('small'));
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['only'])).toEqual(['only']);
  });
});

describe('Rng.pick and weightedPick', () => {
  it('pick throws on empty input', () => {
    expect(() => new Rng(seedRng('x')).pick([])).toThrow(RangeError);
  });

  it('weightedPick follows the weights and never picks zero-weight items', () => {
    const rng = new Rng(seedRng('weights'));
    const items = [
      { id: 'common', w: 7 },
      { id: 'rare', w: 3 },
      { id: 'never', w: 0 },
    ];
    const draws = 50_000;
    const counts: Record<string, number> = { common: 0, rare: 0, never: 0 };
    for (let i = 0; i < draws; i++) {
      const { id } = rng.weightedPick(items, (item) => item.w);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.never).toBe(0);
    expect(Math.abs((counts.common ?? 0) / draws - 0.7)).toBeLessThan(0.01);
  });

  it('weightedPick rejects bad weights', () => {
    const rng = new Rng(seedRng('bad'));
    expect(() => rng.weightedPick([1, 2], () => 0)).toThrow(RangeError);
    expect(() => rng.weightedPick([1], () => -1)).toThrow(RangeError);
    expect(() => rng.weightedPick([1], () => Number.NaN)).toThrow(RangeError);
  });
});

describe('Rng.fork', () => {
  it('is deterministic and advances the parent', () => {
    const p1 = new Rng(seedRng('parent'));
    const p2 = new Rng(seedRng('parent'));
    expect(p1.fork('enemy')).toEqual(p2.fork('enemy'));
    expect(p1.state).toEqual(p2.state);
    expect(p1.fork('enemy')).not.toEqual(p2.fork('deck'));
  });

  it('isolates the child: drawing from it does not change the parent', () => {
    const parent = new Rng(seedRng('iso'));
    const child = new Rng(parent.fork('child'));
    const before = parent.state;
    for (let i = 0; i < 10; i++) child.nextUint32();
    expect(parent.state).toEqual(before);
  });
});
