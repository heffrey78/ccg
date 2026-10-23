import { describe, expect, it } from 'vitest';
import {
  SquareTopology,
  apply,
  boardModule,
  boardTargeting,
  composeRules,
  createBoardState,
  createCardsState,
  createGame,
  createIntentsState,
  fairPolicy,
  intentsModule,
  legalActions,
  locateCard,
  logicModule,
  permanentsModule,
  redactEvents,
  stackModule,
  viewState,
  zone,
  zonesModule,
  type Action,
  type Behavior,
  type BoardConfig,
  type BoardWorld,
  type CardDef,
  type CardsWorld,
  type GameEvent,
  type GameState,
  type IntentsWorld,
  type PermanentsWorld,
  type UnitPlacement,
  type WindowConfig,
} from '../src/index.js';

type World = BoardWorld & CardsWorld & IntentsWorld & PermanentsWorld;

const UNITS = { hero: { hp: 20 }, ally: { hp: 10 }, grunt: { hp: 10 }, turret: { hp: 6 }, totem: { hp: 5 }, snare: { hp: 1 }, battery: { hp: 4 } };
const onTile = (range = 1) => ({ kind: 'tile' as const, range, empty: true });

const CARDS: Record<string, CardDef> = {
  turret: {
    targeting: onTile(),
    permanent: {
      kind: 'structure',
      unit: 'turret',
      abilities: [
        {
          kind: 'triggered',
          on: 'PhaseEnded',
          effects: [
            { op: 'selectUnits', as: 'foes', range: 2, relation: 'enemy' },
            { op: 'damage', target: { $: 'foes' }, amount: 2 },
          ],
        },
      ],
    },
    effects: [],
  },
  totem: { targeting: onTile(), permanent: { kind: 'structure', unit: 'totem', statics: [{ kind: 'maxHp', amount: 2 }] }, effects: [] },
  banner: { targeting: { kind: 'self' }, permanent: { kind: 'attachment', statics: [{ kind: 'damage', on: 'damageDealt', add: 2 }] }, effects: [] },
  snare: {
    targeting: onTile(9),
    permanent: {
      kind: 'trap',
      unit: 'snare',
      abilities: [
        { kind: 'triggered', on: 'UnitEnteredTile', onTile: true, scope: 'enemy', timing: 'when', halt: true, consume: true, effects: [{ op: 'damage', target: { $: 'event.unit' }, amount: 3 }] },
      ],
    },
    effects: [],
  },
  battery: {
    targeting: onTile(),
    permanent: {
      kind: 'structure',
      unit: 'battery',
      abilities: [
        { kind: 'activated', name: 'Mend', cost: { energy: 1 }, targeting: { kind: 'unit', range: 1, filter: 'ally' }, effects: [{ op: 'heal', unit: { $: 'target' }, amount: 3 }] },
      ],
    },
    effects: [],
  },
  ward: {
    targeting: onTile(),
    permanent: {
      kind: 'structure',
      unit: 'battery',
      abilities: [{ kind: 'activated', name: 'Ward', timing: 'reaction', reaction: { kind: ['intent'], targetsYou: true }, effects: [{ op: 'counter' }] }],
    },
    effects: [],
  },
  strike: { targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'damage', amount: 6 }] },
  'mend-ally': { targeting: { kind: 'unit', filter: 'ally' }, effects: [{ op: 'heal', unit: { $: 'target' }, amount: 5 }] },
  sidestep: { timing: 'reaction', reaction: { kind: ['intent'], targetsYou: true }, targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'push', distance: 1, dir: 'e' }] },
  wound: { targeting: { kind: 'unit', filter: 'ally' }, effects: [{ op: 'damage', amount: 4 }] },
};

const STRIKE: Behavior = { kind: 'intent', intent: { name: 'Strike', target: { kind: 'unit', select: 'nearestEnemy', range: 1 }, effects: [{ op: 'damage', amount: 5 }] } };

interface Setup {
  p?: string[];
  e?: string[];
  units: UnitPlacement[];
  behaviors?: Record<string, Behavior>;
  windows?: WindowConfig;
  bothAct?: boolean;
}

function game({ p = [], e = [], units, behaviors = {}, windows, bothAct = false }: Setup) {
  const board: BoardConfig = { topology: new SquareTopology({ width: 5, height: 5 }), units: UNITS, moveAction: { range: 3, oncePerTurn: false } };
  const intents = intentsModule<World>({ topology: board.topology, behaviors });
  const rules = composeRules<World>(
    {
      round: bothAct
        ? [{ id: 'main', perSide: true, interactive: true }]
        : [intents.declarePhase('e'), { id: 'main', side: 'p', interactive: true }, intents.resolvePhase('e')],
      ...(windows && { windows }),
    },
    [
      zonesModule<World>(CARDS, { targeting: boardTargeting<World>(board) }),
      boardModule<World>(board),
      intents,
      permanentsModule<World>({
        topology: board.topology,
        cards: CARDS,
        units: UNITS,
        targeting: (actor) => boardTargeting<World>(board, { actor: () => actor }),
      }),
      stackModule<World>(),
      logicModule<World>(),
    ],
  );
  const cards = createCardsState({ p, e }, { resources: { p: { energy: 3 }, e: { energy: 3 } } });
  for (const side of ['p', 'e']) zone(cards, side, 'hand').push(...zone(cards, side, 'draw').splice(0));
  const created = createGame<World>(rules, {
    seed: 'abilities',
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'ai' },
    ],
    world: { board: createBoardState(UNITS, units), cards, intents: createIntentsState(), permanents: {} },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const events: GameEvent[] = [];
  const run = (action: Action) => {
    const result = apply(rules, state, action);
    if (!result.ok) throw new Error(`${action.type}: ${result.error.message}`);
    state = result.state;
    events.push(...result.events);
    return result.events;
  };
  return {
    rules,
    get state(): GameState<World> {
      return state;
    },
    events,
    run,
    play(side: string, def: string, target?: string) {
      const action = legalActions(rules, state, side).find(
        (a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def && (target === undefined || a.target === target),
      );
      if (!action) throw new Error(`${side} cannot play ${def} at ${target}`);
      return run(action);
    },
    activations: (side: string) => legalActions(rules, state, side).filter((a) => a.type === 'activate'),
    unit: (id: string) => state.world.board.units[id],
    permanentAt: (pos: string) => Object.values(state.world.permanents).find((x) => state.world.board.units[x.unit ?? '']?.pos === pos),
  };
}

const HERO = (pos = '1,2'): UnitPlacement => ({ id: 'P', def: 'hero', side: 'p', pos, facing: 'e' });
const FOE = (pos: string, id = 'E1'): UnitPlacement => ({ id, def: 'grunt', side: 'e', pos, facing: 'w' });

describe('triggered abilities', () => {
  it('a turret shoots nearby enemies at the end of its controller’s turn', () => {
    const g = game({ p: ['turret'], units: [HERO(), FOE('4,2', 'Near'), FOE('4,4', 'Far')], bothAct: true });
    g.play('p', 'turret', '2,2');
    g.run({ type: 'endTurn', side: 'p' });
    expect([g.unit('Near')?.hp, g.unit('Far')?.hp]).toEqual([8, 10]);
    // It fires at the end of its controller's phases only.
    g.run({ type: 'endTurn', side: 'e' });
    expect(g.unit('Near')?.hp).toBe(8);
  });

  it('E3: a hidden trap springs during a reaction’s movement, then the intent whiffs', () => {
    const g = game({
      p: ['snare', 'sidestep'],
      units: [HERO('2,2'), FOE('2,3')],
      behaviors: { grunt: STRIKE },
      windows: { itemAnnounced: true, itemTop: true },
    });
    g.play('p', 'snare', '3,3');
    expect(viewState(g.rules, g.state, 'e').world.board.units).not.toHaveProperty(g.permanentAt('3,3')?.unit as string);
    g.run({ type: 'endTurn', side: 'p' });
    // The strike is announced; the player sidesteps the attacker east, onto the trap.
    const reacted = g.play('p', 'sidestep', 'E1');
    expect(g.unit('E1')).toMatchObject({ pos: '3,3', hp: 7 });
    expect(g.unit('P')?.hp).toBe(20);
    expect(g.events.map((e) => e.type)).toEqual(expect.arrayContaining(['PermanentRevealed', 'IntentWhiffed']));
    const forEnemy = redactEvents(g.rules, reacted, 'e', g.state);
    expect(forEnemy.find((e) => e.type === 'PermanentRevealed')).toMatchObject({ def: 'snare', pos: '3,3' });
    // Single use: it left play and its card is in discard.
    expect(g.state.world.permanents).toEqual({});
    const card = Object.values(g.state.world.cards.instances).find((c) => c.def === 'snare');
    expect(locateCard(g.state.world.cards, card?.id as string)?.zone).toBe('discard');
  });

  it('E13: a fair AI cannot see the trap, walks onto it, and the trap springs', () => {
    const g = game({ p: ['snare'], units: [HERO('0,4'), FOE('2,0')], bothAct: true });
    g.play('p', 'snare', '2,2');
    g.run({ type: 'endTurn', side: 'p' });
    const topo = new SquareTopology({ width: 5, height: 5 });
    const policy = fairPolicy<World>((_r, view, _side, actions) => {
      const traps = new Set(Object.values(view.world.board.units).filter((u) => u.passable).map((u) => u.pos));
      return actions
        .filter((a) => a.type === 'move' && !traps.has(a.to as string))
        .sort((a, b) => topo.distance(a.to as string, '2,4') - topo.distance(b.to as string, '2,4'))[0] as Action;
    });
    const choice = policy.choose(g.rules, viewState(g.rules, g.state, 'e'), 'e', legalActions(g.rules, g.state, 'e'));
    g.run(choice);
    // The move to 2,3 passes over 2,2; the trap halts it there.
    expect(choice.to).toBe('2,3');
    expect(g.unit('E1')).toMatchObject({ pos: '2,2', hp: 7 });
  });
});

describe('statics', () => {
  it('an aura raises max HP of allies in its area, and loses it when they leave', () => {
    const g = game({ p: ['totem', 'mend-ally'], units: [HERO('1,2'), { id: 'A', def: 'ally', side: 'p', pos: '2,3', facing: 'e', hp: 6 }, FOE('4,0')] });
    g.play('p', 'totem', '2,2');
    expect(g.unit('A')).toMatchObject({ hp: 6, maxHp: 12 });
    g.play('p', 'mend-ally', 'A');
    expect(g.unit('A')?.hp).toBe(11);
    g.run({ type: 'move', side: 'p', unit: 'A', to: '2,4' });
    expect(g.unit('A')).toMatchObject({ hp: 10, maxHp: 10 });
    g.run({ type: 'move', side: 'p', unit: 'A', to: '3,2' });
    expect(g.unit('A')?.maxHp).toBe(12);
  });

  it('an attachment’s damage bonus applies to what its host deals', () => {
    const g = game({ p: ['banner', 'strike'], units: [HERO(), FOE('2,2')] });
    g.play('p', 'banner');
    g.play('p', 'strike', 'E1');
    expect(g.unit('E1')?.hp).toBe(2);
  });
});

describe('activated abilities', () => {
  it('cost resources, target from the permanent, once per turn, and not on the turn it arrived', () => {
    const g = game({ p: ['battery', 'wound'], units: [HERO(), FOE('4,4')], bothAct: true });
    g.play('p', 'battery', '2,2');
    g.play('p', 'wound', 'P');
    expect(g.activations('p')).toEqual([]);
    g.run({ type: 'endTurn', side: 'p' });
    g.run({ type: 'endTurn', side: 'e' });
    // The battery may mend any adjacent ally, itself included.
    const mend = g.activations('p');
    expect(mend.map((a) => a.target)).toContain('P');
    g.run(mend.find((a) => a.target === 'P') as Action);
    expect(g.unit('P')?.hp).toBe(19);
    expect(g.state.world.cards.resources.p?.energy).toBe(2);
    expect(g.activations('p')).toEqual([]);
  });

  it('a reaction ability counters an attack', () => {
    const g = game({ p: ['ward'], units: [HERO(), FOE('2,2')], behaviors: { grunt: STRIKE }, windows: { itemAnnounced: true } });
    g.play('p', 'ward', '1,1');
    // Summoning sickness: the ward cannot react on the turn it arrived.
    g.run({ type: 'endTurn', side: 'p' });
    expect(g.unit('P')?.hp).toBe(15);
    g.run({ type: 'endTurn', side: 'p' });
    expect(g.state.prompt).toMatchObject({ side: 'p' });
    g.run(g.activations('p')[0] as Action);
    expect(g.unit('P')?.hp).toBe(15);
    expect(g.events.filter((e) => e.type === 'ItemCountered')).toHaveLength(1);
  });
});
