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
  intentsModule,
  legalActions,
  locateCard,
  logicModule,
  stackModule,
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

const atYou = { kind: ['intent'], targetsYou: true };
const CARDS: Record<string, CardDef> = {
  strike: { targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'damage', amount: 6 }] },
  sidestep: { timing: 'reaction', reaction: atYou, targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'push', distance: 1 }] },
  parry: { timing: 'reaction', reaction: atYou, effects: [{ op: 'counter' }] },
  brace: { timing: 'reaction', reaction: atYou, targeting: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 3 }] },
  dampen: { timing: 'reaction', reaction: atYou, effects: [{ op: 'modify', effect: 'damage', param: 'amount', add: -2 }] },
  deflect: { timing: 'reaction', reaction: atYou, targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'redirect', to: { $: 'target' } }] },
  riposte: { timing: 'reaction', reaction: atYou, effects: [{ op: 'addAfter', effects: [{ op: 'damage', target: 'E', amount: 2 }] }] },
  disrupt: { timing: 'reaction', reaction: { kind: ['card'], reaction: true }, effects: [{ op: 'counter' }] },
};

const STRIKE: Behavior = { kind: 'intent', intent: { name: 'Strike', target: { kind: 'unit', select: 'nearestEnemy', range: 1 }, effects: [{ op: 'damage', amount: 5 }] } };
const ROAR: Behavior = { kind: 'intent', intent: { name: 'Roar', target: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 1 }] } };

function game({ p = [], e = [], units, behavior = STRIKE }: { p?: string[]; e?: string[]; units?: UnitPlacement[]; behavior?: Behavior }) {
  const config: BoardConfig = { topology: new SquareTopology({ width: 5, height: 5 }), units: { hero: { hp: 20 }, grunt: { hp: 10 } } };
  const intents = intentsModule<World>({ topology: config.topology, behaviors: { grunt: behavior } });
  const rules = composeRules<World>(
    {
      round: [intents.declarePhase('e'), { id: 'main', side: 'p', interactive: true }, intents.resolvePhase('e')],
      windows: { itemAnnounced: true, itemTop: true },
    },
    [zonesModule<World>(CARDS, { targeting: boardTargeting<World>(config) }), boardModule<World>(config), intents, stackModule<World>(), logicModule<World>()],
  );
  const cards = createCardsState({ p, e });
  for (const side of ['p', 'e']) zone(cards, side, 'hand').push(...zone(cards, side, 'draw').splice(0));
  const created = createGame<World>(rules, {
    seed: 'react',
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'ai' },
    ],
    world: {
      board: createBoardState(config.units ?? {}, units ?? [
        { id: 'P', def: 'hero', side: 'p', pos: '1,2', facing: 'e' },
        { id: 'E', def: 'grunt', side: 'e', pos: '2,2', facing: 'w' },
      ]),
      cards,
      intents: createIntentsState(),
    },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const events: GameEvent[] = [];
  const run = (action: Action) => {
    const result = apply(rules, state, action);
    if (!result.ok) throw new Error(`${action.type} by ${action.side}: ${result.error.message}`);
    state = result.state;
    events.push(...result.events);
  };
  const reactions = (side: string) =>
    legalActions(rules, state, side).filter((a) => a.type === 'playCard').map((a) => state.world.cards.instances[a.card as string]?.def);
  return {
    rules,
    get state(): GameState<World> {
      return state;
    },
    events,
    reactions,
    endTurn: () => run({ type: 'endTurn', side: 'p' }),
    pass: (side: string) => run({ type: 'pass', side }),
    play(side: string, def: string, target?: string) {
      const action = legalActions(rules, state, side).find(
        (a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def && (target === undefined || a.target === target),
      );
      if (!action) throw new Error(`${side} cannot play ${def} now`);
      run(action);
    },
    hp: (id: string) => state.world.board.units[id]?.hp,
    zoneOf: (def: string) => {
      const card = Object.values(state.world.cards.instances).find((c) => c.def === def);
      return card && locateCard(state.world.cards, card.id)?.zone;
    },
  };
}

describe('reaction cards', () => {
  it('a reaction pushes the attacker away, so its attack misses', () => {
    const g = game({ p: ['sidestep'] });
    g.endTurn();
    expect(g.state.prompt).toMatchObject({ window: 'itemAnnounced', side: 'p' });
    g.play('p', 'sidestep', 'E');
    expect(g.state.prompt).toBeNull();
    expect(g.state.world.board.units.E?.pos).toBe('3,2');
    expect(g.hp('P')).toBe(20);
    expect(g.events.map((e) => e.type)).toContain('IntentWhiffed');
  });

  it('E5: a reaction is countered by the enemy, and the player responds again when the attack is top', () => {
    const g = game({ p: ['parry', 'brace'], e: ['disrupt'] });
    g.endTurn();
    g.play('p', 'parry');
    // The enemy answers the parry with Disrupt; the player has nothing that answers Disrupt.
    expect(g.state.prompt).toMatchObject({ side: 'e' });
    expect(g.reactions('e')).toEqual(['disrupt']);
    g.play('e', 'disrupt');
    // Disrupt resolves and counters Parry; Parry resolves as countered; the attack is top again.
    expect(g.state.prompt).toMatchObject({ window: 'itemTop', side: 'p' });
    expect(g.reactions('p')).toEqual(['brace']);
    g.play('p', 'brace');
    expect(g.state.prompt).toBeNull();
    expect(g.hp('P')).toBe(18);
    expect(g.events.filter((e) => e.type === 'ItemCountered')).toHaveLength(1);
    expect([g.zoneOf('parry'), g.zoneOf('brace'), g.zoneOf('disrupt')]).toEqual(['discard', 'discard', 'discard']);
  });

  it('reactions are not legal in the main phase or outside their condition', () => {
    const g = game({ p: ['parry', 'strike'], behavior: ROAR });
    expect(g.reactions('p')).toEqual(['strike']);
    g.endTurn();
    // The enemy's Roar targets itself, not one of the player's units: nothing to parry, so no prompt.
    expect(g.state.prompt).toBeNull();
    expect(g.zoneOf('parry')).toBe('hand');
  });

  it('a played counter is offered only against an opponent’s reaction', () => {
    const g = game({ p: ['brace'], e: ['disrupt'] });
    g.endTurn();
    expect(g.reactions('e')).toEqual([]);
    g.play('p', 'brace');
    expect(g.state.prompt).toMatchObject({ side: 'e' });
    g.pass('e');
    expect(g.hp('P')).toBe(18);
  });

  it('modify changes a parameter of the attack, redirect changes its target, addAfter adds effects', () => {
    const dampened = game({ p: ['dampen'] });
    dampened.endTurn();
    dampened.play('p', 'dampen');
    expect(dampened.hp('P')).toBe(17);

    const deflected = game({
      p: ['deflect'],
      units: [
        { id: 'P', def: 'hero', side: 'p', pos: '1,2', facing: 'e' },
        { id: 'E', def: 'grunt', side: 'e', pos: '2,2', facing: 'w' },
        { id: 'E2', def: 'grunt', side: 'e', pos: '2,3', facing: 'w' },
      ],
    });
    deflected.endTurn();
    // Both grunts telegraph a strike at P; deflect the first onto the other grunt.
    deflected.play('p', 'deflect', 'E2');
    expect(deflected.hp('E2')).toBe(5);

    const riposted = game({ p: ['riposte'] });
    riposted.endTurn();
    riposted.play('p', 'riposte');
    expect([riposted.hp('P'), riposted.hp('E')]).toEqual([15, 8]);
  });
});
