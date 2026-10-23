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
  legalActions,
  locateCard,
  logicModule,
  permanentsModule,
  permanentsPlayable,
  redactEvents,
  viewState,
  zone,
  zonesModule,
  type Action,
  type BoardConfig,
  type BoardWorld,
  type CardDef,
  type CardsWorld,
  type GameState,
  type PermanentsWorld,
  type UnitPlacement,
} from '../src/index.js';

type World = BoardWorld & CardsWorld & PermanentsWorld;

const UNITS = { hero: { hp: 20 }, grunt: { hp: 10 }, wall: { hp: 8 }, snare: { hp: 1 }, wolf: { hp: 6 } };
const tile = (range = 1) => ({ kind: 'tile' as const, range, empty: true });
const CARDS: Record<string, CardDef> = {
  barricade: { cost: { energy: 1 }, targeting: tile(), permanent: { kind: 'structure', unit: 'wall' }, effects: [], upgrade: { effects: [] } },
  'summon-wolf': { targeting: tile(), permanent: { kind: 'unit', unit: 'wolf' }, effects: [] },
  'smoke-pillar': { targeting: tile(), permanent: { kind: 'structure', unit: 'wall', duration: 2 }, effects: [] },
  snare: { targeting: tile(2), permanent: { kind: 'trap', unit: 'snare' }, effects: [] },
  'war-banner': { targeting: { kind: 'unit', range: 0, filter: 'ally' }, permanent: { kind: 'attachment', leaveTo: 'hand' }, effects: [] },
  smash: { targeting: { kind: 'unit', filter: 'any' }, effects: [{ op: 'damage', amount: 20 }] },
  recall: { targeting: { kind: 'unit', filter: 'any' }, effects: [{ op: 'returnPermanent', zone: 'hand' }] },
  charm: { targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'gainControl' }] },
};

function game({ hand, units, maxPerSide }: { hand: Record<string, string[]>; units: UnitPlacement[]; maxPerSide?: number }) {
  const config: BoardConfig = { topology: new SquareTopology({ width: 5, height: 5 }), units: UNITS, moveAction: { range: 2 } };
  const permanents = { topology: config.topology, cards: CARDS, units: UNITS, ...(maxPerSide !== undefined && { maxPerSide }) };
  const rules = composeRules<World>({ round: [{ id: 'main', perSide: true, interactive: true }] }, [
    zonesModule<World>(CARDS, { targeting: boardTargeting<World>(config), playable: permanentsPlayable<World>(permanents) }),
    boardModule<World>(config),
    permanentsModule<World>(permanents),
    logicModule<World>(),
  ]);
  const cards = createCardsState(hand, { resources: { p: { energy: 5 }, e: { energy: 5 } } });
  for (const side of Object.keys(hand)) zone(cards, side, 'hand').push(...zone(cards, side, 'draw').splice(0));
  const created = createGame<World>(rules, {
    seed: 'perm',
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'human' },
    ],
    world: { board: createBoardState(UNITS, units), cards, permanents: {} },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const run = (action: Action) => {
    const result = apply(rules, state, action);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    state = result.state;
    return result.events;
  };
  const options = (side: string, def: string) =>
    legalActions(rules, state, side).filter((a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def);
  return {
    rules,
    get state(): GameState<World> {
      return state;
    },
    options,
    play(side: string, def: string, target: string) {
      const action = options(side, def).find((a) => a.target === target);
      if (!action) throw new Error(`cannot play ${def} at ${target}`);
      return run(action);
    },
    endTurn: (side: string) => run({ type: 'endTurn', side }),
    move: (unit: string, to: string) => run({ type: 'move', side: 'p', unit, to }),
    cardOf: (def: string) => Object.values(state.world.cards.instances).find((c) => c.def === def)?.id as string,
    where: (card: string) => locateCard(state.world.cards, card),
    permanentOn: (pos: string) => Object.values(state.world.permanents).find((p) => state.world.board.units[p.unit ?? '']?.pos === pos || p.pos === pos),
  };
}

const HERO = (pos = '1,2'): UnitPlacement => ({ id: 'P', def: 'hero', side: 'p', pos, facing: 'e' });
const FOE = (pos = '4,2'): UnitPlacement => ({ id: 'E', def: 'grunt', side: 'e', pos, facing: 'w' });

describe('permanents', () => {
  it('a structure occupies and blocks its tile, and when destroyed its card goes to discard with its upgrade', () => {
    const g = game({ hand: { p: ['barricade', 'smash'], e: [] }, units: [HERO(), FOE()] });
    const card = g.cardOf('barricade');
    const instance = g.state.world.cards.instances[card];
    if (instance) instance.upgraded = true;
    const events = g.play('p', 'barricade', '2,2');
    const wall = g.permanentOn('2,2');
    expect(wall).toMatchObject({ kind: 'structure', card, owner: 'p', controller: 'p' });
    expect(g.where(card)?.zone).toBe('inPlay');
    expect(events.map((e) => e.type)).toContain('PermanentEntered');
    // It blocks: the hero cannot walk through it.
    const moves = legalActions(g.rules, g.state, 'p').filter((a) => a.type === 'move').map((a) => a.to);
    expect(moves).not.toContain('2,2');
    expect(moves).not.toContain('3,2');

    g.play('p', 'smash', wall?.id as string);
    expect(g.state.world.permanents).toEqual({});
    expect(g.where(card)).toMatchObject({ side: 'p', zone: 'discard' });
    expect(g.state.world.cards.instances[card]?.upgraded).toBe(true);
  });

  it('a timed permanent leaves play at the end of its controller’s last phase', () => {
    const g = game({ hand: { p: ['smoke-pillar'], e: [] }, units: [HERO(), FOE()] });
    g.play('p', 'smoke-pillar', '2,2');
    g.endTurn('p');
    expect(g.permanentOn('2,2')).toMatchObject({ turnsLeft: 1 });
    g.endTurn('e');
    expect(g.permanentOn('2,2')).toBeDefined();
    g.endTurn('p');
    expect(g.permanentOn('2,2')).toBeUndefined();
    expect(g.where(g.cardOf('smoke-pillar'))?.zone).toBe('discard');
  });

  it('a permanent under another side’s control still returns to its owner', () => {
    const g = game({ hand: { p: ['summon-wolf'], e: ['charm', 'smash'] }, units: [HERO(), FOE()] });
    g.play('p', 'summon-wolf', '2,2');
    const wolf = g.permanentOn('2,2');
    g.endTurn('p');
    g.play('e', 'charm', wolf?.id as string);
    expect(g.state.world.permanents[wolf?.id as string]).toMatchObject({ owner: 'p', controller: 'e' });
    expect(g.state.world.board.units[wolf?.id as string]?.side).toBe('e');
    g.play('e', 'smash', wolf?.id as string);
    expect(g.where(g.cardOf('summon-wolf'))).toMatchObject({ side: 'p', zone: 'discard' });
  });

  it('returning a permanent puts its card in its owner’s chosen zone', () => {
    const g = game({ hand: { p: ['barricade', 'recall'], e: [] }, units: [HERO(), FOE()] });
    g.play('p', 'barricade', '2,2');
    g.play('p', 'recall', g.permanentOn('2,2')?.id as string);
    expect(g.where(g.cardOf('barricade'))?.zone).toBe('hand');
    expect(g.state.world.board.units).not.toHaveProperty(g.cardOf('barricade'));
    expect(Object.keys(g.state.world.board.units)).toEqual(['P', 'E']);
  });

  it('a trap is passable and hidden from the other side, card and all', () => {
    const g = game({ hand: { p: ['snare'], e: [] }, units: [HERO(), FOE()] });
    const events = g.play('p', 'snare', '3,2');
    const trap = g.permanentOn('3,2');
    const forEnemy = viewState(g.rules, g.state, 'e');
    expect(forEnemy.world.board.units).not.toHaveProperty(trap?.unit as string);
    expect(zone(forEnemy.world.cards, 'p', 'inPlay')[0]).toMatch(/^h/);
    expect(redactEvents(g.rules, events, 'e', g.state).some((e) => e.type === 'PermanentEntered' || e.def === 'snare')).toBe(false);
    // Units can still walk onto it.
    g.endTurn('p');
    g.endTurn('e');
    expect(legalActions(g.rules, g.state, 'p').some((a) => a.type === 'move' && a.to === '3,2')).toBe(true);
  });

  it('an attachment leaves play with its host and goes where its card says', () => {
    const g = game({ hand: { p: ['war-banner'], e: ['smash'] }, units: [HERO(), FOE()] });
    g.play('p', 'war-banner', 'P');
    expect(Object.values(g.state.world.permanents)[0]).toMatchObject({ kind: 'attachment', unit: 'P' });
    g.endTurn('p');
    g.play('e', 'smash', 'P');
    expect(g.state.world.board.units).not.toHaveProperty('P');
    expect(g.state.world.permanents).toEqual({});
    expect(g.where(g.cardOf('war-banner'))?.zone).toBe('hand');
  });

  it('summoned units cannot use the move action on the turn they arrive', () => {
    const g = game({ hand: { p: ['summon-wolf'], e: [] }, units: [HERO(), FOE()] });
    g.play('p', 'summon-wolf', '2,2');
    const wolf = g.permanentOn('2,2')?.id as string;
    expect(legalActions(g.rules, g.state, 'p').some((a) => a.type === 'move' && a.unit === wolf)).toBe(false);
    g.endTurn('p');
    g.endTurn('e');
    expect(legalActions(g.rules, g.state, 'p').some((a) => a.type === 'move' && a.unit === wolf)).toBe(true);
  });

  it('enforces a maximum number of permanents per side', () => {
    const g = game({ hand: { p: ['barricade', 'summon-wolf'], e: [] }, units: [HERO(), FOE()], maxPerSide: 1 });
    g.play('p', 'barricade', '2,2');
    expect(g.options('p', 'summon-wolf')).toEqual([]);
  });
});
