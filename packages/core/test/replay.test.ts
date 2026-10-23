import { describe, expect, it } from 'vitest';
import {
  ENGINE_API_VERSION,
  Rng,
  Session,
  apply,
  hashState,
  isEngineCompatible,
  legalActions,
  parseSnapshot,
  replay,
  seedRng,
  serializeSnapshot,
  type GameSetup,
} from '../src/index.js';
import { ENEMY, PLAYER, laneRules, unit, world, type LaneWorld } from './lane-game.js';

const CARDS = {
  poke: [{ op: 'damageRandomEnemyOf', side: PLAYER, amount: 2 }],
  shove: [{ op: 'push', unit: 'E1', distance: 2 }],
  pull: [{ op: 'push', unit: 'E2', distance: 1, dir: -1 }],
  study: [{ op: 'draw', n: 2 }],
  sweep: [{ op: 'damage', target: ['E1', 'E2', 'E3'], amount: 1 }],
};

/** A randomized but valid lane setup. */
function randomSetup(seed: number): GameSetup<LaneWorld> {
  const rng = new Rng(seedRng(`setup-${seed}`));
  const names = Object.keys(CARDS);
  const deck = Array.from({ length: 12 }, () => rng.pick(names));
  return {
    seed,
    sides: [
      { id: PLAYER, controller: 'human' },
      { id: ENEMY, controller: 'ai' },
    ],
    world: world({
      length: 8,
      walls: rng.chance(0.5) ? [7] : [],
      hazards: rng.chance(0.5) ? { [String(rng.int(3, 6))]: 2 } : {},
      collision: rng.pick(['stop', 'bump', 'chain'] as const),
      units: {
        P: unit('P', PLAYER, 0, 30),
        E1: unit('E1', ENEMY, 2, rng.int(3, 9), { onDeath: [{ op: 'damageAdjacent', pos: { $: 'event.pos' }, amount: 1 }] }),
        E2: unit('E2', ENEMY, 4, rng.int(3, 9)),
        E3: unit('E3', ENEMY, 6, rng.int(3, 9), { block: rng.int(0, 3) }),
      },
      statuses: rng.chance(0.5) ? [{ side: PLAYER, status: 'opportunist', createdAt: 0 }] : [],
      cards: CARDS,
      hand: deck.splice(0, 4),
      deck,
      enemyPlan: [[{ op: 'attack', attacker: 'E2', target: 'P', amount: 2 }]],
    }),
  };
}

/** Plays random legal actions, returning the session and the hash after each step. */
function playRandomly(seed: number, maxActions = 12) {
  const started = Session.start(laneRules, randomSetup(seed), { sample: '0.1.0' });
  if (!started.ok) throw new Error(started.error.message);
  const { session } = started;
  const chooser = new Rng(seedRng(`choices-${seed}`));
  const hashes = [hashState(session.state)];
  for (let i = 0; i < maxActions && !session.state.outcome; i++) {
    const options = legalActions(laneRules, session.state, PLAYER);
    const result = session.apply(chooser.pick(options));
    if (!result.ok) throw new Error(`seed ${seed}: ${result.error.message}`);
    hashes.push(hashState(session.state));
  }
  return { session, hashes };
}

describe('replay', () => {
  it('reproduces identical state hashes for 1,000 random games', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const { session, hashes } = playRandomly(seed);
      const result = replay(laneRules, session.log);
      if (!result.ok) throw new Error(`seed ${seed}: replay failed at ${result.at}: ${result.error.message}`);
      expect(result.hashes).toEqual(hashes);
    }
  });

  it('records the engine API, packages and setup in the log', () => {
    const { session } = playRandomly(7, 3);
    expect(session.log).toMatchObject({ format: 1, engineApi: ENGINE_API_VERSION, packages: { sample: '0.1.0' } });
    expect(session.log.actions.length).toBeGreaterThan(0);
  });

  it('reports the index of the first action that no longer applies', () => {
    const { session } = playRandomly(3, 4);
    const log = session.log;
    log.actions.splice(1, 0, { type: 'play', side: PLAYER, card: 'not-a-card' });
    const result = replay(laneRules, log);
    expect(result).toMatchObject({ ok: false, at: 1, error: { code: 'illegal-action' } });
  });

  it('refuses logs from an incompatible engine API', () => {
    const { session } = playRandomly(1, 1);
    expect(replay(laneRules, { ...session.log, engineApi: '9.0.0' })).toMatchObject({
      ok: false,
      at: -1,
      error: { code: 'incompatible' },
    });
  });
});

describe('snapshots', () => {
  it('round-trip through JSON to an identical state', () => {
    for (const seed of [11, 12, 13]) {
      const { session } = playRandomly(seed, 6);
      const text = serializeSnapshot(session.snapshot());
      const parsed = parseSnapshot<LaneWorld>(text);
      if (!parsed.ok) throw new Error(parsed.error.message);
      expect(parsed.snapshot.state).toEqual(session.state);
      expect(hashState(parsed.snapshot.state)).toBe(hashState(session.state));
      expect(serializeSnapshot(parsed.snapshot)).toBe(text);
    }
  });

  it('continue identically after loading', () => {
    const { session } = playRandomly(21, 3);
    const loaded = parseSnapshot<LaneWorld>(serializeSnapshot(session.snapshot()));
    if (!loaded.ok) throw new Error(loaded.error.message);
    const action = legalActions(laneRules, session.state, PLAYER)[0];
    if (!action) throw new Error('no legal action');
    const fromLoaded = apply(laneRules, loaded.snapshot.state, action);
    const fromLive = session.apply(action);
    if (!fromLoaded.ok || !fromLive.ok) throw new Error('action failed');
    expect(hashState(fromLoaded.state)).toBe(hashState(fromLive.state));
    expect(fromLoaded.events).toEqual(fromLive.events);
  });

  it('reject malformed text and incompatible versions', () => {
    expect(parseSnapshot('not json')).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(parseSnapshot('{"format":1}')).toMatchObject({ ok: false, error: { code: 'malformed' } });
    const { session } = playRandomly(5, 1);
    const snap = session.snapshot();
    expect(parseSnapshot(serializeSnapshot({ ...snap, engineApi: '1.0.0' }))).toMatchObject({
      ok: false,
      error: { code: 'incompatible' },
    });
    expect(parseSnapshot(JSON.stringify({ ...snap, format: 2 }))).toMatchObject({
      ok: false,
      error: { code: 'incompatible' },
    });
  });
});

describe('isEngineCompatible', () => {
  it.each([
    ['0.3.1', '0.3.4', true],
    ['0.3.4', '0.3.1', false],
    ['0.2.0', '0.3.0', false],
    ['1.2.0', '1.4.0', true],
    ['1.4.0', '1.2.0', false],
    ['1.0.0', '2.0.0', false],
    ['nope', '1.0.0', false],
  ])('%s read by %s → %s', (saved, current, expected) => {
    expect(isEngineCompatible(saved, current)).toBe(expected);
  });
});
