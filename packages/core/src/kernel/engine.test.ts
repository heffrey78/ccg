import { describe, expect, it } from 'vitest';
import { hashState } from '../hash.js';
import { Rng, seedRng } from '../rng.js';
import { END_TURN, apply, createGame, legalActions, schedule } from './engine.js';
import type { Action, GameRules, GameState, Listener, Side } from './types.js';

/** A probe game: a counter world and a log of what ran. */
interface Probe {
  log: string[];
  value: number;
}

const SIDES: Side[] = [
  { id: 'a', controller: 'human' },
  { id: 'b', controller: 'ai' },
];

function probeRules(overrides: Partial<GameRules<Probe>> = {}): GameRules<Probe> {
  return {
    round: [
      { id: 'upkeep', enter: (ctx) => ctx.state.world.log.push(`upkeep r${ctx.state.turn.round}`) },
      { id: 'main', perSide: true, interactive: true },
      { id: 'cleanup' },
    ],
    ops: {
      add(ctx, p) {
        ctx.step({ kind: 'add', amount: p.amount });
      },
      note(ctx, p) {
        ctx.step({ kind: 'note', text: p.text });
      },
      boom() {
        throw new Error('boom');
      },
    },
    steps: {
      add(state, s) {
        state.world.value += s.amount as number;
        return [{ type: 'Added', amount: s.amount }];
      },
      note(state, s) {
        state.world.log.push(String(s.text));
        return [{ type: 'Noted', text: s.text }];
      },
    },
    actions: {
      cast: {
        list: (_state, side) => [1, 2].map((amount) => ({ type: 'cast', side, amount })),
        perform(ctx, action) {
          ctx.announce({
            kind: 'card',
            controller: action.side,
            source: null,
            effects: [{ op: 'add', amount: action.amount }],
            vars: {},
          });
        },
      },
    },
    ...overrides,
  };
}

function start(rules = probeRules()): GameState<Probe> {
  const result = createGame(rules, { seed: 'probe', sides: SIDES, world: { log: [], value: 0 } });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function must<W>(result: ReturnType<typeof apply<W>>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

describe('createGame and phases', () => {
  it('expands per-side phases in side order', () => {
    expect(schedule(probeRules(), SIDES).map((s) => `${s.def.id}:${s.activeSide}`)).toEqual([
      'upkeep:null',
      'main:a',
      'main:b',
      'cleanup:null',
    ]);
  });

  it('runs automatic phases and stops at the first interactive one', () => {
    const state = start();
    expect(state.turn).toEqual({ round: 1, slot: 1, phase: 'main', activeSide: 'a' });
    expect(state.world.log).toEqual(['upkeep r1']);
  });

  it('endTurn passes to the next side, then wraps into a new round', () => {
    const rules = probeRules();
    let state = start(rules);
    state = must(apply(rules, state, { type: END_TURN, side: 'a' })).state;
    expect(state.turn).toMatchObject({ round: 1, phase: 'main', activeSide: 'b' });

    const { state: next, events } = must(apply(rules, state, { type: END_TURN, side: 'b' }));
    expect(next.turn).toMatchObject({ round: 2, phase: 'main', activeSide: 'a' });
    expect(next.world.log).toEqual(['upkeep r1', 'upkeep r2']);
    expect(events.map((e) => e.type)).toEqual([
      'TurnEnded',
      'PhaseEnded',
      'PhaseStarted', // cleanup
      'PhaseEnded',
      'RoundStarted',
      'PhaseStarted', // upkeep
      'PhaseEnded',
      'PhaseStarted', // main:a
    ]);
  });

  it('offers actions only to the active side in an interactive phase', () => {
    const rules = probeRules();
    const state = start(rules);
    expect(legalActions(rules, state, 'a').map((a) => a.type)).toEqual(['cast', 'cast', END_TURN]);
    expect(legalActions(rules, state, 'b')).toEqual([]);
  });

  it('rejects rules with no interactive phase, or an interactive phase with no side', () => {
    const noInteractive = createGame(probeRules({ round: [{ id: 'x' }] }), {
      seed: 1,
      sides: SIDES,
      world: { log: [], value: 0 },
    });
    expect(noInteractive).toMatchObject({ ok: false, error: { code: 'invalid-content' } });

    const sideless = createGame(probeRules({ round: [{ id: 'x', interactive: true }] }), {
      seed: 1,
      sides: SIDES,
      world: { log: [], value: 0 },
    });
    expect(sideless).toMatchObject({ ok: false, error: { code: 'invalid-content' } });
  });
});

describe('apply', () => {
  it('resolves an announced item and returns the events', () => {
    const rules = probeRules();
    const { state, events } = must(apply(rules, start(rules), { type: 'cast', side: 'a', amount: 2 }));
    expect(state.world.value).toBe(2);
    expect(events.map((e) => e.type)).toEqual(['ItemAnnounced', 'ItemResolving', 'Added', 'ItemResolved']);
    expect(events[2]?.cause).toEqual({ action: 1, item: events[0]?.item, effect: 0 });
  });

  it('rejects illegal actions and leaves the state unchanged', () => {
    const rules = probeRules();
    const state = start(rules);
    const before = hashState(state);
    for (const action of [
      { type: 'cast', side: 'a', amount: 3 },
      { type: 'cast', side: 'b', amount: 1 },
      { type: END_TURN, side: 'b' },
      { type: 'nope', side: 'a' },
    ] as Action[]) {
      expect(apply(rules, state, action)).toMatchObject({ ok: false, error: { code: 'illegal-action' } });
    }
    expect(hashState(state)).toBe(before);
  });

  it('never modifies the input state, even on success', () => {
    const rules = probeRules();
    const state = start(rules);
    const before = hashState(state);
    must(apply(rules, state, { type: 'cast', side: 'a', amount: 1 }));
    expect(hashState(state)).toBe(before);
  });

  it('reports unknown ops and variables as invalid content, with the state unchanged', () => {
    const badOp = probeRules({
      actions: {
        cast: {
          list: (_s, side) => [{ type: 'cast', side }],
          perform: (ctx, a) =>
            ctx.announce({ kind: 'card', controller: a.side, source: null, effects: [{ op: 'missing' }], vars: {} }),
        },
      },
    });
    const state = start(badOp);
    const before = hashState(state);
    expect(apply(badOp, state, { type: 'cast', side: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-content', message: "unknown op 'missing'" },
    });

    const badVar = probeRules({
      actions: {
        cast: {
          list: (_s, side) => [{ type: 'cast', side }],
          perform: (ctx, a) =>
            ctx.announce({
              kind: 'card',
              controller: a.side,
              source: null,
              effects: [{ op: 'add', amount: { $: 'nope.x' } }],
              vars: {},
            }),
        },
      },
    });
    expect(apply(badVar, start(badVar), { type: 'cast', side: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-content', message: "unknown variable 'nope.x'" },
    });
    expect(hashState(state)).toBe(before);
  });

  it('is deterministic: the same seed and random action sequences give identical states', () => {
    const rules = probeRules({
      ops: {
        ...probeRules().ops,
        roll(ctx) {
          ctx.step({ kind: 'add', amount: ctx.rng.int(1, 6) });
        },
      },
      actions: {
        roll: {
          list: (_s, side) => [{ type: 'roll', side }],
          perform: (ctx, a) =>
            ctx.announce({ kind: 'card', controller: a.side, source: null, effects: [{ op: 'roll' }], vars: {} }),
        },
      },
    });
    const playout = (actionSeed: number) => {
      const chooser = new Rng(seedRng(actionSeed));
      let state = start(rules);
      const hashes: string[] = [];
      for (let i = 0; i < 25; i++) {
        const side = state.turn.activeSide as string;
        state = must(apply(rules, state, chooser.pick(legalActions(rules, state, side)))).state;
        hashes.push(hashState(state));
      }
      return hashes;
    };
    for (let seed = 0; seed < 50; seed++) expect(playout(seed)).toEqual(playout(seed));
    expect(playout(1)).not.toEqual(playout(2));
  });
});

describe('listeners', () => {
  /** Starts a probe game with these listeners and casts once. */
  function castWith(listeners: Listener<Probe>[], amount = 1) {
    const rules = probeRules({ listeners: () => listeners });
    return apply(rules, start(rules), { type: 'cast', side: 'a', amount });
  }

  const base = { source: null, controller: 'a', layer: 'status', timestamp: 0 } as const;
  const trigger = (id: string, extra: Partial<Listener<Probe>> = {}): Listener<Probe> =>
    ({
      ...base,
      kind: 'trigger',
      id,
      matches: (e) => e.type === 'Added',
      effects: [{ op: 'note', text: id }],
      ...extra,
    }) as Listener<Probe>;

  it('orders simultaneous triggers by layer, then controller from the active side, then timestamp', () => {
    const { state } = must(
      castWith([
        trigger('card-a', { layer: 'card' }),
        trigger('status-b', { controller: 'b' }),
        trigger('status-a-late', { timestamp: 5 }),
        trigger('status-a-early', { timestamp: 1 }),
        trigger('rules', { layer: 'rules', controller: null }),
      ]),
    );
    expect(state.world.log.slice(1)).toEqual(['rules', 'status-a-early', 'status-a-late', 'status-b', 'card-a']);
  });

  it('applies each matching modifier once per step, and can prevent a step', () => {
    const double: Listener<Probe> = {
      ...base,
      kind: 'modifier',
      id: 'double',
      matches: (s) => s.kind === 'add',
      modify: (s) => [{ ...s, amount: (s.amount as number) * 2 }],
    };
    expect(must(castWith([double], 2)).state.world.value).toBe(4);

    const { state, events } = must(castWith([{ ...double, id: 'prevent', modify: () => [] }], 2));
    expect(state.world.value).toBe(0);
    expect(events.some((e) => e.type === 'Added')).toBe(false);
  });

  it('runs interrupts inline before the effect continues', () => {
    const { events } = must(
      castWith([
        {
          ...base,
          kind: 'interrupt',
          id: 'echo',
          matches: (e) => e.type === 'Added',
          effects: [{ op: 'note', text: 'interrupted' }],
        },
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(['ItemAnnounced', 'ItemResolving', 'Added', 'Noted', 'ItemResolved']);
    expect(events[3]?.cause.via).toBe('echo');
  });

  it('rejects runaway interrupt nesting', () => {
    const result = castWith([
      { ...base, kind: 'interrupt', id: 'recurse', matches: (e) => e.type === 'Added', effects: [{ op: 'add', amount: 1 }] },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: 'resolution-limit' } });
  });

  it('passes the matching event to trigger effects as a variable', () => {
    const { state } = must(castWith([trigger('echo-amount', { effects: [{ op: 'note', text: { $: 'event.amount' } }] })], 2));
    expect(state.world.log.at(-1)).toBe('2');
  });
});

describe('game end', () => {
  it('ends the game when an outcome is met and rejects further actions', () => {
    const rules = probeRules({ outcome: (s) => (s.world.value >= 2 ? { winners: ['a'], reason: 'reached 2' } : null) });
    const { state, events } = must(apply(rules, start(rules), { type: 'cast', side: 'a', amount: 2 }));
    expect(state.outcome).toEqual({ winners: ['a'], reason: 'reached 2' });
    expect(events.at(-1)?.type).toBe('GameEnded');
    expect(legalActions(rules, state, 'a')).toEqual([]);
    expect(apply(rules, state, { type: END_TURN, side: 'a' })).toMatchObject({ ok: false, error: { code: 'game-over' } });
  });
});
