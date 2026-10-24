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
  logicModule,
  permanentsModule,
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
  type GameView,
  type IntentsWorld,
  type PermanentsWorld,
  type StatePolicy,
  type UnitPlacement,
  type WindowConfig,
} from '../src/index.js';

type World = BoardWorld & CardsWorld & IntentsWorld & PermanentsWorld;

const UNITS = { hero: { hp: 20 }, grunt: { hp: 10 }, snare: { hp: 1 } };
const CARDS: Record<string, CardDef> = {
  scout: { effects: [{ op: 'peek', n: 2 }] },
  mix: { effects: [{ op: 'shuffle', zone: 'draw' }] },
  flaunt: { effects: [{ op: 'reveal', card: 'card1' }] },
  hide: { effects: [{ op: 'conceal', card: 'card1' }] },
  ambush: { faceDown: true, targeting: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 3 }] },
  snare: { targeting: { kind: 'tile', range: 9, empty: true }, permanent: { kind: 'trap', unit: 'snare' }, effects: [] },
  filler: { effects: [] },
  beacon: { targeting: { kind: 'tile', range: 9, empty: true }, permanent: { kind: 'structure', unit: 'snare' }, effects: [] },
  block: { effects: [] },
};

interface Setup {
  hand?: string[];
  deck?: string[];
  units?: UnitPlacement[];
  fog?: BoardConfig['fog'];
  tiles?: Record<string, string>;
  windows?: WindowConfig;
}

function game({ hand = [], deck = [], units = [], fog, tiles = {}, windows }: Setup) {
  const config: BoardConfig = {
    topology: new SquareTopology({ width: 5, height: 5 }),
    units: UNITS,
    tiles: { wall: { blocking: true } },
    moveAction: { range: 2, oncePerTurn: false },
    ...(fog && { fog }),
  };
  const intents = intentsModule<World>({
    topology: config.topology,
    behaviors: { grunt: { kind: 'intent', intent: { name: 'Bite', target: { kind: 'unit', select: 'nearestEnemy' }, effects: [] } } },
  });
  const rules = composeRules<World>(
    {
      round: [intents.declarePhase('e'), { id: 'main', perSide: true, interactive: true }],
      ...(windows && { windows }),
      actions: {
        // Lets side e respond to anything, so a window pauses.
        stall: { list: () => [], respond: (_s, side) => (side === 'e' ? [{ type: 'stall', side }] : []), perform: () => {} },
      },
    },
    [
      zonesModule<World>(CARDS, { targeting: boardTargeting<World>(config) }),
      boardModule<World>(config),
      intents,
      permanentsModule<World>({ topology: config.topology, cards: CARDS, units: UNITS }),
      logicModule<World>(),
    ],
  );
  const cards = createCardsState({ p: [...hand, ...deck], e: [] });
  zone(cards, 'p', 'hand').push(...zone(cards, 'p', 'draw').splice(0, hand.length));
  const created = createGame<World>(rules, {
    seed: 'hidden',
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'ai' },
    ],
    world: { board: createBoardState(UNITS, units, tiles), cards, intents: createIntentsState(), permanents: {} },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  return {
    rules,
    get state(): GameState<World> {
      return state;
    },
    play(def: string, target?: string) {
      const action = legalActions(rules, state, 'p').find(
        (a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def && (target === undefined || a.target === target),
      );
      if (!action) throw new Error(`cannot play ${def}`);
      const result = apply(rules, state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      return result.events;
    },
    act(action: Action) {
      const result = apply(rules, state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      return result.events;
    },
    view: (viewer: string | null) => viewState(rules, state, viewer),
  };
}

const HERO = (pos: string): UnitPlacement => ({ id: 'P', def: 'hero', side: 'p', pos, facing: 'e' });
const FOE = (pos: string, id = 'E'): UnitPlacement => ({ id, def: 'grunt', side: 'e', pos, facing: 'w' });
const knownDefs = (view: GameView<World>, side: string, name: string) =>
  zone(view.world.cards, side, name).map((id) => view.world.cards.instances[id]?.def ?? '?');

describe('card visibility', () => {
  it('peek shows the top cards to the peeker only, until a shuffle', () => {
    const g = game({ hand: ['scout', 'mix'], deck: ['block', 'filler', 'filler'] });
    g.play('scout');
    expect(knownDefs(g.view('p'), 'p', 'draw')).toEqual(['block', 'filler', '?']);
    expect(knownDefs(g.view('e'), 'p', 'draw')).toEqual(['?', '?', '?']);
    g.play('mix');
    expect(knownDefs(g.view('p'), 'p', 'draw')).toEqual(['?', '?', '?']);
  });

  it('reveal shows a hand card to everyone; conceal hides it again', () => {
    const g = game({ hand: ['block', 'flaunt', 'hide'] });
    expect(g.view('e').world.cards.instances).not.toHaveProperty('card1');
    const events = g.play('flaunt');
    expect(g.view('e').world.cards.instances.card1?.def).toBe('block');
    expect(redactEvents(g.rules, events, 'e', g.state).find((e) => e.type === 'CardRevealed')).toMatchObject({ def: 'block', card: 'card1' });
    g.play('hide');
    expect(g.view('e').world.cards.instances).not.toHaveProperty('card1');
  });

  it('a face-down card is hidden when played and while on the stack, and revealed once it resolves', () => {
    const g = game({ hand: ['ambush'], units: [HERO('1,1')], windows: { itemAnnounced: true } });
    const played = g.play('ambush');
    // The opponent may respond, so the card sits on the stack.
    expect(g.view('e').stack).toEqual([{ id: expect.any(String), kind: 'hidden', controller: 'p', source: null, countered: false }]);
    expect(g.view('p').stack[0]).toMatchObject({ kind: 'card', source: 'card1' });
    const forE = redactEvents(g.rules, played, 'e', g.state);
    expect(forE.find((e) => e.type === 'ItemAnnounced')).toMatchObject({ kind: 'hidden', source: null, secret: true });
    expect(forE.some((e) => e.def === 'ambush' || e.card === 'card1')).toBe(false);

    const resolved = g.act({ type: 'pass', side: 'e' });
    expect(g.state.world.board.units.P?.block).toBe(3);
    expect(knownDefs(g.view('e'), 'p', 'discard')).toEqual(['ambush']);
    expect(redactEvents(g.rules, resolved, 'e', g.state).some((e) => e.type === 'CardRevealed' && e.def === 'ambush')).toBe(true);
  });

  it('traps are played face-down by default', () => {
    const g = game({ hand: ['snare'], units: [HERO('0,0')] });
    const events = g.play('snare', '2,2');
    const forE = redactEvents(g.rules, events, 'e', g.state);
    expect(forE.some((e) => e.def === 'snare')).toBe(false);
    expect(g.view('e').world.permanents).toEqual({});
    expect(Object.values(g.view('p').world.permanents)).toHaveLength(1);
  });
});

describe('fog of war', () => {
  it('distance fog hides units, their events and their intents beyond range', () => {
    const g = game({ units: [HERO('0,0'), FOE('4,4', 'Far'), FOE('1,1', 'Near')], fog: { kind: 'distance', range: 3 } });
    const view = g.view('p');
    expect(Object.keys(view.world.board.units).sort()).toEqual(['Near', 'P']);
    expect(view.world.intents.declared.map((i) => i.unit)).toEqual(['Near']);
    expect(Object.keys(g.view('e').world.board.units).sort()).toEqual(['Far', 'Near', 'P']);
  });

  it('an unseen unit’s intent is announced without naming it', () => {
    const g = game({ units: [HERO('0,0'), FOE('4,4', 'Far'), FOE('0,1', 'Near')], fog: { kind: 'distance', range: 1 } });
    const announce = (source: string) => ({ type: 'ItemAnnounced', item: 'item9', kind: 'intent', controller: 'e', source, cause: { action: 0 } });
    const [far, near] = redactEvents(g.rules, [announce('Far'), announce('Near')], 'p', g.state);
    expect(far).toMatchObject({ type: 'ItemAnnounced', kind: 'intent', source: null });
    expect(near).toMatchObject({ source: 'Near' });
    expect(redactEvents(g.rules, [announce('Far')], 'e', g.state)[0]).toMatchObject({ source: 'Far' });
  });

  it('line of sight is blocked by walls, and by units when configured', () => {
    const units = [HERO('0,2'), FOE('4,2', 'Behind'), FOE('2,0', 'Open')];
    const walls = game({ units, tiles: { '2,2': 'wall' }, fog: { kind: 'lineOfSight' } });
    expect(Object.keys(walls.view('p').world.board.units).sort()).toEqual(['Open', 'P']);

    const crowd = game({ units: [...units, FOE('1,2', 'Front')], fog: { kind: 'lineOfSight', unitsBlock: true } });
    expect(Object.keys(crowd.view('p').world.board.units).sort()).toEqual(['Front', 'Open', 'P']);
  });

  it('spectators see only what every side sees', () => {
    const g = game({ units: [HERO('0,0'), FOE('4,4', 'Far')], fog: { kind: 'distance', range: 3 } });
    expect(Object.keys(g.view(null).world.board.units)).toEqual([]);
  });
});

describe('fair and cheating AI (E13, without the trap springing — #58)', () => {
  /** Walk toward the goal, avoiding tiles with a unit you know is passable (a trap). */
  const toward = (goal: string, units: Record<string, { pos: string; passable?: boolean }>, actions: Action[]) => {
    const traps = new Set(Object.values(units).filter((u) => u.passable).map((u) => u.pos));
    const topo = new SquareTopology({ width: 5, height: 5 });
    const moves = actions.filter((a) => a.type === 'move' && !traps.has(a.to as string));
    return moves.sort((a, b) => topo.distance(a.to as string, goal) - topo.distance(b.to as string, goal))[0] as Action;
  };
  const cheat: StatePolicy<World> = { choose: (_r, state, _s, actions) => toward('2,4', state.world.board.units, actions) };
  const fair = fairPolicy<World>((_r, view, _s, actions) => toward('2,4', view.world.board.units, actions));

  it('a fair AI cannot see the hidden trap and walks onto it; a cheating AI avoids it', () => {
    const g = game({ hand: ['snare'], units: [HERO('0,4'), FOE('2,0')] });
    g.play('snare', '2,2');
    g.act({ type: 'endTurn', side: 'p' });
    const actions = legalActions(g.rules, g.state, 'e');
    expect(fair.choose(g.rules, viewState(g.rules, g.state, 'e'), 'e', actions)).toMatchObject({ to: '2,2' });
    expect(cheat.choose(g.rules, g.state, 'e', actions).to).not.toBe('2,2');
  });
});

describe('fog of war vision', () => {
  it('a view under fog lists the tiles the viewer can see', () => {
    const g = game({ units: [HERO('0,0'), FOE('4,4', 'Far')], fog: { kind: 'distance', range: 1 } });
    expect(g.view('p').world.board.vision?.sort()).toEqual(['0,0', '0,1', '1,0'].sort());
    expect(g.view(null).world.board.vision).toEqual([]);
    expect(g.state.world.board.vision).toBeUndefined();
    expect(game({ units: [HERO('0,0')] }).view('p').world.board.vision).toBeUndefined();
  });
});

describe('sight from structures (#106)', () => {
  it('a structure you own pushes back the fog around it', () => {
    const g = game({ hand: ['beacon'], units: [HERO('0,0'), FOE('4,4', 'Far')], fog: { kind: 'distance', range: 1 } });
    expect(Object.keys(g.view('p').world.board.units)).toEqual(['P']);
    g.play('beacon', '4,3');
    const view = g.view('p');
    expect(Object.keys(view.world.board.units)).toContain('Far');
    expect(view.world.board.vision).toEqual(expect.arrayContaining(['4,3', '4,4', '3,3']));
  });
});
