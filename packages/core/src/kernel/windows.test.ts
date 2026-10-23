import { describe, expect, it } from 'vitest';
import { hashState } from '../hash.js';
import { greedyPolicy, playTurn } from '../ai.js';
import { Session, replay } from '../replay.js';
import { END_TURN, PASS, apply, createGame, legalActions } from './engine.js';
import type { Action, GameEvent, GameRules, GameState, WindowConfig } from './types.js';

/** Two sides; each holds some counters it can play in response to the other side's top item. */
interface Duel {
  log: string[];
  counters: Record<string, number>;
  /** Side b may also play a "last word" during a phase-end window. */
  lastWords: number;
}

function duelRules(windows?: WindowConfig, maxStackDepth?: number): GameRules<Duel> {
  return {
    round: [{ id: 'main', perSide: true, interactive: true }],
    ...(windows && { windows }),
    ...(maxStackDepth && { limits: { maxStackDepth } }),
    ops: {
      note(ctx, p) {
        ctx.step({ kind: 'note', text: p.text });
      },
    },
    steps: {
      note(state, s) {
        state.world.log.push(String(s.text));
        return [{ type: 'Noted', text: s.text }];
      },
      spend(state, s) {
        const side = s.side as string;
        state.world.counters[side] = (state.world.counters[side] ?? 0) - 1;
        return [];
      },
    },
    actions: {
      cast: {
        list: (_s, side) => [{ type: 'cast', side }],
        perform: (ctx, a) => ctx.announce({ kind: 'card', controller: a.side, source: null, effects: [{ op: 'note', text: `${a.side}:spell` }], vars: {} }),
      },
      counter: {
        list: () => [],
        respond(state, side, prompt) {
          const top = state.stack.at(-1);
          const ok = prompt.window !== 'phaseEnd' && top !== undefined && top.controller !== side && (state.world.counters[side] ?? 0) > 0;
          return ok ? [{ type: 'counter', side }] : [];
        },
        perform(ctx, a) {
          ctx.step({ kind: 'spend', side: a.side });
          const depth = ctx.state.stack.length;
          ctx.announce({ kind: 'reaction', controller: a.side, source: null, effects: [{ op: 'note', text: `${a.side}:counter${depth}` }], vars: {} });
        },
      },
      lastWord: {
        list: () => [],
        respond: (state, side, prompt) => (prompt.window === 'phaseEnd' && side === 'b' && state.world.lastWords > 0 ? [{ type: 'lastWord', side }] : []),
        perform(ctx, a) {
          ctx.state.world.lastWords -= 1;
          ctx.announce({ kind: 'reaction', controller: a.side, source: null, effects: [{ op: 'note', text: 'b:last word' }], vars: {} });
        },
      },
    },
  };
}

function start(rules: GameRules<Duel>, counters: Record<string, number> = { a: 3, b: 3 }, lastWords = 0) {
  const result = createGame<Duel>(rules, {
    seed: 'duel',
    sides: [
      { id: 'a', controller: 'human' },
      { id: 'b', controller: 'ai' },
    ],
    world: { log: [], counters, lastWords },
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function act(rules: GameRules<Duel>, state: GameState<Duel>, type: string, side: string) {
  const result = apply(rules, state, { type, side } as Action);
  if (!result.ok) throw new Error(`${type} by ${side}: ${result.error.code} ${result.error.message}`);
  return result;
}

const types = (events: GameEvent[]) => events.map((e) => e.type);

describe('response windows', () => {
  it('with no windows configured, play is identical and never pauses', () => {
    const run = (rules: GameRules<Duel>) => {
      let state = start(rules);
      const hashes: string[] = [];
      for (const [type, side] of [['cast', 'a'], [END_TURN, 'a'], ['cast', 'b'], [END_TURN, 'b']] as const) {
        state = act(rules, state, type, side).state;
        expect(state.prompt).toBeNull();
        hashes.push(hashState(state));
      }
      return hashes;
    };
    expect(run(duelRules({}))).toEqual(run(duelRules()));
  });

  it('a nested response chain resolves last in, first out', () => {
    const rules = duelRules({ itemAnnounced: true });
    let state = act(rules, start(rules), 'cast', 'a').state;
    expect(state.prompt).toMatchObject({ kind: 'priority', window: 'itemAnnounced', side: 'b' });
    expect(legalActions(rules, state, 'a')).toEqual([]);
    expect(legalActions(rules, state, 'b')).toEqual([
      { type: 'counter', side: 'b' },
      { type: PASS, side: 'b' },
    ]);

    state = act(rules, state, 'counter', 'b').state;
    expect(state.prompt?.side).toBe('a');
    state = act(rules, state, 'counter', 'a').state;
    state = act(rules, state, 'counter', 'b').state;
    expect(state.stack).toHaveLength(4);
    // a declines; b cannot counter its own item, so it auto-passes and the chain unwinds.
    const { state: done } = act(rules, state, PASS, 'a');
    expect(done.prompt).toBeNull();
    expect(done.world.log).toEqual(['b:counter3', 'a:counter2', 'b:counter1', 'a:spell']);
  });

  it('no responses are legal once the stack reaches the depth limit', () => {
    const rules = duelRules({ itemAnnounced: true }, 2);
    let state = act(rules, start(rules), 'cast', 'a').state;
    state = act(rules, state, 'counter', 'b').state;
    expect(state.prompt).toBeNull();
    expect(state.world.log).toEqual(['b:counter1', 'a:spell']);
  });

  it('auto-passes sides with nothing to play, so they are never prompted', () => {
    const rules = duelRules({ itemAnnounced: true });
    const { state, events } = act(rules, start(rules, { a: 3, b: 0 }), 'cast', 'a');
    expect(state.prompt).toBeNull();
    expect(state.world.log).toEqual(['a:spell']);
    expect(types(events)).toEqual(expect.arrayContaining(['WindowOpened', 'WindowClosed']));
    expect(types(events)).not.toContain('PriorityGiven');
  });

  it('itemTop gives priority again when an item becomes the top again', () => {
    const rules = duelRules({ itemAnnounced: true, itemTop: true });
    let state = act(rules, start(rules), 'cast', 'a').state;
    state = act(rules, state, 'counter', 'b').state;
    // a passes on b's counter; it resolves, a's spell is top again, and b may respond again.
    state = act(rules, state, PASS, 'a').state;
    expect(state.prompt).toMatchObject({ window: 'itemTop', side: 'b' });
    state = act(rules, state, 'counter', 'b').state;
    state = act(rules, state, PASS, 'a').state;
    state = act(rules, state, PASS, 'b').state;
    expect(state.world.log).toEqual(['b:counter1', 'b:counter1', 'a:spell']);
  });

  it('a phase-end window lets the other side act before the phase advances', () => {
    const rules = duelRules({ phaseEnd: ['main'] });
    let state = start(rules, { a: 0, b: 0 }, 1);
    state = act(rules, state, END_TURN, 'a').state;
    expect(state.prompt).toMatchObject({ window: 'phaseEnd', item: null, side: 'b' });
    expect(state.turn.activeSide).toBe('a');
    const { state: after } = act(rules, state, 'lastWord', 'b');
    expect(after.world.log).toEqual(['b:last word']);
    expect(after.turn).toMatchObject({ phase: 'main', activeSide: 'b' });
    expect(after.turn.ending).toBeUndefined();
  });

  it('replays reproduce games that paused for priority', () => {
    const rules = duelRules({ itemAnnounced: true, itemTop: true });
    const started = Session.start<Duel>(rules, {
      seed: 'duel',
      sides: [
        { id: 'a', controller: 'human' },
        { id: 'b', controller: 'ai' },
      ],
      world: { log: [], counters: { a: 3, b: 3 }, lastWords: 0 },
    });
    if (!started.ok) throw new Error(started.error.message);
    const { session } = started;
    const hashes = [hashState(session.state)];
    // b passes on a's counter, so it resolves and b's counter is top again: priority goes to a,
    // then a passes, b's counter resolves, a's spell is top again and b gets priority.
    for (const [type, side] of [['cast', 'a'], ['counter', 'b'], ['counter', 'a'], [PASS, 'b'], [PASS, 'a'], [PASS, 'b'], [END_TURN, 'a']] as const) {
      const result = session.apply({ type, side });
      if (!result.ok) throw new Error(`${type} by ${side}: ${result.error.message}`);
      hashes.push(hashState(session.state));
    }
    const replayed = replay(rules, session.log);
    expect(replayed.ok && replayed.hashes).toEqual(hashes);
  });

  it('an AI side answers its prompt through a policy', () => {
    const rules = duelRules({ itemAnnounced: true });
    const prompted = act(rules, start(rules, { a: 0, b: 1 }), 'cast', 'a').state;
    // A policy that prefers keeping the log short counters the spell.
    const policy = greedyPolicy<Duel>((s) => -s.stack.length - s.world.log.filter((l) => l === 'a:spell').length);
    const result = playTurn(rules, prompted, 'b', policy);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.prompt).toBeNull();
    expect(result.state.world.log).toEqual(['b:counter1', 'a:spell']);
  });
});
