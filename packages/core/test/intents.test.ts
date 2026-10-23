import { createContentSchemas } from '@ccg/content';
import { describe, expect, it } from 'vitest';
import {
  SquareTopology,
  apply,
  boardModule,
  boardTargeting,
  builtinOps,
  composeRules,
  createBoardState,
  createCardsState,
  createGame,
  createIntentsState,
  greedyPolicy,
  hashState,
  intentsModule,
  legalActions,
  logicModule,
  playTurn,
  randomPolicy,
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
  type UnitPlacement,
} from '../src/index.js';

type World = BoardWorld & CardsWorld & IntentsWorld;

const intent = (name: string, target: object, effects: object[], extra: object = {}): Behavior =>
  ({ kind: 'intent', intent: { name, target, effects, ...extra } }) as Behavior;

const LANCE = intent('Lance', { kind: 'pattern', shape: { kind: 'line', length: 3 }, aim: 'nearestEnemy' }, [{ op: 'damage', amount: 5 }]);
const SLAM = intent('Slam', { kind: 'unit', select: 'nearestEnemy', bound: 'tile' }, [{ op: 'damage', amount: 4 }]);
const SHOOT = intent('Shoot', { kind: 'unit', select: 'nearestEnemy', range: 3 }, [{ op: 'damage', amount: 3 }]);
const BITE = intent('Bite', { kind: 'unit', select: 'nearestEnemy', range: 1 }, [{ op: 'damage', amount: 2 }]);

const CARDS: Record<string, CardDef> = {
  shove: { targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'push', distance: 2 }] },
  stun: { targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'cancelIntent' }] },
  stall: { targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'delayIntent' }] },
  strike: { targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'damage', amount: 6 }] },
  defend: { targeting: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 5 }] },
  kill: { targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: 99 }] },
  swap: { targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'swap' }] },
};

interface Setup {
  behaviors: Record<string, Behavior>;
  units: UnitPlacement[];
  hand?: string[];
  seed?: string | number;
}

const P = (pos: string, id = 'P'): UnitPlacement => ({ id, def: 'hero', side: 'p', pos, facing: 'e' });
const E = (pos: string, def = 'grunt', id = 'E1'): UnitPlacement => ({ id, def, side: 'e', pos, facing: 'w' });

function game({ behaviors, units, hand = [], seed = 'intents' }: Setup) {
  const unitDefs = { hero: { hp: 30 }, ally: { hp: 30 }, grunt: { hp: 10 }, ogre: { hp: 10 } };
  const config: BoardConfig = { topology: new SquareTopology({ width: 6, height: 5 }), units: unitDefs, moveAction: { range: 2 } };
  const intents = intentsModule<World>({ topology: config.topology, behaviors });
  const rules = composeRules<World>(
    { round: [intents.declarePhase('e'), { id: 'main', side: 'p', interactive: true }, intents.resolvePhase('e')] },
    [zonesModule<World>(CARDS, { targeting: boardTargeting<World>(config) }), boardModule<World>(config), intents, logicModule<World>()],
  );
  const cards = createCardsState({ p: hand, e: [] }, { resources: { p: { energy: 9 } } });
  zone(cards, 'p', 'hand').push(...zone(cards, 'p', 'draw').splice(0));
  const created = createGame(rules, {
    seed,
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'ai' },
    ],
    world: { board: createBoardState(unitDefs, units), cards, intents: createIntentsState() },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const run = (action: Omit<Action, 'side'>) => {
    const result = apply(rules, state, { side: 'p', ...action } as Action);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    state = result.state;
    return result.events;
  };
  const playCard = (def: string, target?: string) => {
    const action = legalActions(rules, state, 'p').find(
      (a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def && (target === undefined || a.target === target),
    );
    if (!action) throw new Error(`cannot play ${def}`);
    return run(action);
  };
  return {
    rules,
    get state(): GameState<World> {
      return state;
    },
    run,
    playCard,
    move: (unit: string, to: string) => run({ type: 'move', unit, to }),
    endTurn: () => run({ type: 'endTurn' }),
    unit: (id: string) => state.world.board.units[id],
    declared: () => state.world.intents.declared,
  };
}

const types = (events: GameEvent[]) => events.map((e) => e.type);

describe('telegraphed intents', () => {
  it('are declared before the player acts and exposed in state', () => {
    const g = game({ behaviors: { grunt: LANCE }, units: [P('1,2'), E('4,2')] });
    expect(g.declared()).toEqual([
      expect.objectContaining({ unit: 'E1', name: 'Lance', bound: 'tile', dir: 'w', cells: ['1,2', '2,2', '3,2'] }),
    ]);
  });

  it('stepping out of a telegraphed line attack avoids its damage', () => {
    const dodge = game({ behaviors: { grunt: LANCE }, units: [P('1,2'), E('4,2')] });
    dodge.move('P', '1,1');
    const events = dodge.endTurn();
    expect(dodge.unit('P')?.hp).toBe(30);
    expect(types(events)).toContain('IntentResolved');

    const stay = game({ behaviors: { grunt: LANCE }, units: [P('1,2'), E('4,2')] });
    stay.endTurn();
    expect(stay.unit('P')?.hp).toBe(25);
  });

  it('E11: a tile-bound slam misses a target that moved; a unit-bound shot out of range whiffs', () => {
    const g = game({
      behaviors: { grunt: SLAM, ogre: SHOOT },
      units: [P('2,2'), E('3,2', 'grunt', 'E1'), E('5,2', 'ogre', 'E2')],
    });
    expect(g.declared().map((i) => [i.name, i.bound, i.target])).toEqual([
      ['Slam', 'tile', '2,2'],
      ['Shoot', 'unit', 'P'],
    ]);
    g.move('P', '0,2');
    const events = g.endTurn();
    expect(g.unit('P')?.hp).toBe(30);
    expect(types(events)).toEqual(expect.arrayContaining(['IntentResolved', 'IntentWhiffed']));
  });

  it('a tile-bound attack hits whatever stands on its tiles, even its own side', () => {
    const g = game({ behaviors: { grunt: SLAM }, units: [P('2,2'), E('3,2', 'grunt', 'E1'), E('2,3', 'ogre', 'E2')], hand: ['swap'] });
    // The hero trades places with the ogre, leaving the ogre on the slammed tile.
    g.playCard('swap', 'E2');
    g.endTurn();
    expect([g.unit('P')?.hp, g.unit('E2')?.hp]).toEqual([30, 6]);
  });

  it('pushing the attacker away makes a melee intent whiff', () => {
    const g = game({ behaviors: { grunt: BITE }, units: [P('1,2'), E('2,2')], hand: ['shove'] });
    g.playCard('shove', 'E1');
    const events = g.endTurn();
    expect(g.unit('P')?.hp).toBe(30);
    expect(types(events)).toContain('IntentWhiffed');
  });

  it('with onInvalidTarget: retarget, it picks a new target in reach', () => {
    const bite = intent('Bite', { kind: 'unit', select: 'nearestEnemy', range: 1 }, [{ op: 'damage', amount: 2 }], { onInvalidTarget: 'retarget' });
    const g = game({ behaviors: { grunt: bite }, units: [P('1,2'), { ...P('4,1', 'A'), def: 'ally' }, E('2,2')], hand: ['shove'] });
    g.playCard('shove', 'E1');
    g.endTurn();
    expect([g.unit('P')?.hp, g.unit('A')?.hp]).toEqual([30, 28]);
  });

  it('an enemy that dies before acting loses its intent', () => {
    const g = game({ behaviors: { grunt: BITE }, units: [P('1,2'), E('2,2')], hand: ['kill'] });
    const events = g.playCard('kill', 'E1');
    expect(types(events)).toContain('IntentCancelled');
    expect(g.declared()).toEqual([]);
  });

  it('cancelIntent stops an intent; delayIntent pushes it to the next round', () => {
    const stunned = game({ behaviors: { grunt: BITE }, units: [P('1,2'), E('2,2')], hand: ['stun'] });
    stunned.playCard('stun', 'E1');
    stunned.endTurn();
    expect(stunned.unit('P')?.hp).toBe(30);

    const stalled = game({ behaviors: { grunt: BITE }, units: [P('1,2'), E('2,2')], hand: ['stall'] });
    stalled.playCard('stall', 'E1');
    stalled.endTurn();
    expect(stalled.unit('P')?.hp).toBe(30);
    expect(stalled.declared()).toHaveLength(1);
    stalled.endTurn();
    expect(stalled.unit('P')?.hp).toBe(28);
  });
});

describe('behaviours', () => {
  const names = (g: ReturnType<typeof game>, rounds: number) => {
    const out: string[] = [];
    for (let i = 0; i < rounds; i++) {
      out.push(g.declared()[0]?.name ?? '-');
      g.endTurn();
    }
    return out;
  };

  it('sequence cycles through its steps', () => {
    const cycle: Behavior = { kind: 'sequence', steps: [SHOOT, SLAM, LANCE] };
    expect(names(game({ behaviors: { grunt: cycle }, units: [P('0,0'), E('5,4')] }), 5)).toEqual(['Shoot', 'Slam', 'Lance', 'Shoot', 'Slam']);
  });

  it('weighted picks repeat exactly for the same seed', () => {
    const coin: Behavior = { kind: 'weighted', options: [{ weight: 1, then: SHOOT }, { weight: 1, then: SLAM }] };
    const run = (seed: number) => names(game({ behaviors: { grunt: coin }, units: [P('0,0'), E('5,4')], seed }), 8).join();
    for (let seed = 0; seed < 5; seed++) expect(run(seed)).toBe(run(seed));
    expect(new Set(Array.from({ length: 10 }, (_, seed) => run(seed))).size).toBeGreaterThan(1);
  });

  it('conditional: bite when adjacent, otherwise approach', () => {
    const hunter: Behavior = {
      kind: 'if',
      cond: { kind: 'enemyWithin', range: 1 },
      then: BITE,
      else: intent('Stalk', { kind: 'unit', select: 'nearestEnemy' }, [{ op: 'approach', distance: 2 }]),
    };
    const g = game({ behaviors: { grunt: hunter }, units: [P('0,2'), E('5,2')] });
    expect(g.declared()[0]?.name).toBe('Stalk');
    g.endTurn();
    expect(g.unit('E1')?.pos).toBe('3,2');
    g.endTurn();
    expect(g.unit('E1')?.pos).toBe('1,2');
    expect(g.declared()[0]?.name).toBe('Bite');
    g.endTurn();
    expect(g.unit('P')?.hp).toBe(28);
  });

  it('behaviours are content: they validate, with errors located inside the tree', () => {
    const schemas = createContentSchemas(builtinOps());
    const unit = { formatVersion: 1, kind: 'unit', id: 'hunter', name: 'Hunter', hp: 10, behavior: { kind: 'sequence', steps: [BITE, LANCE] } };
    expect(schemas.unit.safeParse(unit).success).toBe(true);
    const bad = structuredClone(unit) as { behavior: { steps: { intent: { effects: object[] } }[] } };
    (bad.behavior.steps[1] as { intent: { effects: object[] } }).intent.effects = [{ op: 'damage', amount: -2 }];
    const paths = schemas.unit.safeParse(bad).error?.issues.map((i) => i.path.join('/'));
    expect(paths).toContain('behavior/steps/1/intent/effects/0/amount');
  });
});

describe('AI policies', () => {
  it('greedy lookahead picks the action with the best resulting score', () => {
    const g = game({ behaviors: {}, units: [P('1,2'), E('2,2')], hand: ['defend', 'strike'] });
    const policy = greedyPolicy<World>((s) => -Object.values(s.world.board.units).filter((u) => u.side === 'e').reduce((n, u) => n + u.hp, 0));
    const choice = policy.choose(g.rules, g.state, 'p', legalActions(g.rules, g.state, 'p'));
    expect(g.state.world.cards.instances[choice.card as string]?.def).toBe('strike');
  });

  it('random policies with the same seed play the same turn; playTurn ends the turn', () => {
    const turn = () => {
      const g = game({ behaviors: { grunt: BITE }, units: [P('1,2'), E('3,3')], hand: ['defend', 'strike', 'shove'] });
      const result = playTurn(g.rules, g.state, 'p', randomPolicy<World>('ai'));
      if (!result.ok) throw new Error(result.error.message);
      return hashState(result.state);
    };
    expect(turn()).toBe(turn());
  });
});
