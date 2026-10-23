import { describe, expect, it } from 'vitest';
import { createCardsState, zonesModule, type CardsWorld } from '../cards/zones.js';
import { apply, createGame, legalActions } from '../kernel/engine.js';
import type { Action, Effect, GameEvent, GameState } from '../kernel/types.js';
import { composeRules, type RulesModule } from '../rules/compose.js';
import { LaneTopology } from './lane.js';
import { SquareTopology } from './square.js';
import type { Topology } from './topology.js';
import { boardModule, createBoardState, type BoardConfig, type BoardWorld, type UnitPlacement } from './units.js';

type World = BoardWorld & Partial<CardsWorld>;

const UNITS = { hero: { hp: 20 }, grunt: { hp: 5 }, totem: { hp: 3 } };
const TILES = { wall: { blocking: true }, spikes: { onEnter: [{ op: 'damage', target: { $: 'event.unit' }, amount: 2, source: 'terrain' }] } };

interface Setup {
  topology?: Topology;
  placements: UnitPlacement[];
  tiles?: Record<string, string>;
  /** Named effect lists the player can cast, each from a source unit. */
  spells?: Record<string, { source: string; effects: Effect[] }>;
  config?: Partial<BoardConfig>;
  withCards?: boolean;
}

function game({ topology = new LaneTopology(5), placements, tiles = {}, spells = {}, config = {}, withCards = false }: Setup) {
  const modules: RulesModule<World>[] = [boardModule<World>({ topology, tiles: TILES, units: UNITS, ...config })];
  if (withCards) modules.push(zonesModule<World & CardsWorld>({}) as RulesModule<World>);
  const rules = composeRules<World>(
    {
      round: [
        { id: 'main', side: 'p', interactive: true },
        { id: 'enemy', side: 'e' },
      ],
      actions: {
        cast: {
          list: (_s, side) => (side === 'p' ? Object.keys(spells).map((spell) => ({ type: 'cast', side, spell })) : []),
          perform(ctx, action) {
            const spell = spells[action.spell as string];
            if (!spell) return;
            ctx.announce({ kind: 'card', controller: 'p', source: spell.source, effects: spell.effects, vars: {} });
          },
        },
      },
    },
    modules,
  );
  const world: World = { board: createBoardState(UNITS, placements, tiles) };
  if (withCards) world.cards = createCardsState({ p: [], e: [] }, { resources: { p: { energy: 2 } } });
  const created = createGame(rules, {
    seed: 'board',
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'ai' },
    ],
    world,
  });
  if (!created.ok) throw new Error(created.error.message);

  let state = created.state;
  const act = (action: Omit<Action, 'side'>) => {
    const result = apply(rules, state, { side: 'p', ...action } as Action);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    state = result.state;
    return result.events;
  };
  return {
    rules,
    get state(): GameState<World> {
      return state;
    },
    cast: (spell: string) => act({ type: 'cast', spell }),
    act,
    unit: (id: string) => state.world.board.units[id],
  };
}

const at = (id: string, def: string, side: string, pos: string, facing = 'e'): UnitPlacement => ({ id, def, side, pos, facing });
const types = (events: GameEvent[]) => events.map((e) => e.type);
const pushE1 = (distance: number) => ({ shove: { source: 'P', effects: [{ op: 'push', unit: 'E1', distance }] } });

describe('forced movement and collision rules', () => {
  describe.each(['stop', 'bump', 'chain'] as const)('collision %s', (collision) => {
    it('into a wall tile', () => {
      const g = game({
        placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '1')],
        tiles: { 3: 'wall' },
        spells: pushE1(3),
        config: { collision },
      });
      g.cast('shove');
      expect(g.unit('E1')).toMatchObject({ pos: '2', hp: collision === 'stop' ? 5 : 4 });
    });

    it('into another unit', () => {
      const g = game({
        placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '1'), at('E2', 'grunt', 'e', '3')],
        spells: pushE1(2),
        config: { collision },
      });
      const events = g.cast('shove');
      const expected = {
        stop: { e1: ['2', 5], e2: ['3', 5] },
        bump: { e1: ['2', 4], e2: ['3', 4] },
        chain: { e1: ['3', 5], e2: ['4', 5] },
      }[collision];
      expect([g.unit('E1')?.pos, g.unit('E1')?.hp]).toEqual(expected.e1);
      expect([g.unit('E2')?.pos, g.unit('E2')?.hp]).toEqual(expected.e2);
      if (collision === 'bump') expect(types(events)).toContain('UnitCollided');
    });

    it('off the board edge (edge treated as a wall)', () => {
      const g = game({
        placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '3')],
        spells: pushE1(3),
        config: { collision },
      });
      g.cast('shove');
      expect(g.unit('E1')).toMatchObject({ pos: '4', hp: collision === 'stop' ? 5 : 4 });
    });
  });

  it('with edge: fall, a unit pushed off the board dies', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '3')],
      spells: pushE1(3),
      config: { edge: 'fall' },
    });
    const events = g.cast('shove');
    expect(g.unit('E1')).toBeUndefined();
    expect(types(events)).toEqual(expect.arrayContaining(['UnitFell', 'UnitDied', 'UnitLeftPlay']));
  });
});

describe('tiles', () => {
  it('a hazard triggers on entry during a push and during a voluntary step', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '1')],
      tiles: { 2: 'spikes' },
      spells: pushE1(1),
    });
    g.cast('shove');
    expect(g.unit('E1')).toMatchObject({ pos: '2', hp: 3 });

    const walker = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '4')],
      tiles: { 1: 'spikes' },
      spells: { walk: { source: 'P', effects: [{ op: 'step', unit: 'P', dir: 'e', distance: 2 }] } },
    });
    walker.cast('walk');
    expect(walker.unit('P')).toMatchObject({ pos: '2', hp: 18 });
  });

  it('lethal hazard damage halts the rest of the push', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), { ...at('E1', 'grunt', 'e', '1'), hp: 2 }],
      tiles: { 2: 'spikes', 4: 'wall' },
      spells: pushE1(3),
    });
    const events = g.cast('shove');
    expect(g.unit('E1')).toBeUndefined();
    expect(types(events)).not.toContain('UnitCollided');
    expect(events.filter((e) => e.type === 'UnitEnteredTile')).toHaveLength(1);
  });

  it('voluntary movement stops before walls and units without collision damage', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '4')],
      tiles: { 3: 'wall' },
      spells: { dash: { source: 'P', effects: [{ op: 'step', unit: 'P', dir: 'e', distance: 4 }] } },
    });
    g.cast('dash');
    expect(g.unit('P')).toMatchObject({ pos: '2', hp: 20, facing: 'e' });
  });
});

describe('the same push on different boards', () => {
  it('pushes away from the source on a lane and a square grid', () => {
    const lane = game({ placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '1')], spells: pushE1(2) });
    lane.cast('shove');
    expect(lane.unit('E1')?.pos).toBe('3');

    const square = game({
      topology: new SquareTopology({ width: 5, height: 5 }),
      placements: [at('P', 'hero', 'p', '0,2'), at('E1', 'grunt', 'e', '1,2')],
      spells: pushE1(2),
    });
    square.cast('shove');
    expect(square.unit('E1')?.pos).toBe('3,2');
  });

  it('picks the best direction when source and target are not aligned', () => {
    const square = game({
      topology: new SquareTopology({ width: 5, height: 5 }),
      placements: [at('P', 'hero', 'p', '0,0'), at('E1', 'grunt', 'e', '1,2')],
      spells: pushE1(1),
    });
    square.cast('shove');
    // e and s both increase distance most; e comes first clockwise from n.
    expect(square.unit('E1')?.pos).toBe('2,2');
  });

  it('pull moves toward the source and stops adjacent', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '3')],
      spells: { hook: { source: 'P', effects: [{ op: 'pull', unit: 'E1', distance: 5 }] } },
    });
    g.cast('hook');
    expect(g.unit('E1')?.pos).toBe('1');
  });
});

describe('other movement', () => {
  const square = () =>
    game({
      topology: new SquareTopology({ width: 4, height: 4 }),
      placements: [at('P', 'hero', 'p', '0,0'), at('E1', 'grunt', 'e', '3,3'), at('E2', 'grunt', 'e', '2,0')],
      tiles: { '1,0': 'wall', '1,1': 'wall' },
      spells: {
        swap: { source: 'P', effects: [{ op: 'swap', a: 'P', b: 'E1' }] },
        blink: { source: 'P', effects: [{ op: 'teleport', unit: 'P', to: '0,3' }] },
        blinkOccupied: { source: 'P', effects: [{ op: 'teleport', unit: 'P', to: '2,0' }] },
        travel: { source: 'P', effects: [{ op: 'moveTo', unit: 'P', to: '2,1' }] },
        turn: { source: 'P', effects: [{ op: 'face', unit: 'P', dir: 's' }] },
      },
    });

  it('swaps and teleports without collisions; teleport onto a unit does nothing', () => {
    const g = square();
    g.cast('swap');
    expect([g.unit('P')?.pos, g.unit('E1')?.pos]).toEqual(['3,3', '0,0']);
    const h = square();
    h.cast('blinkOccupied');
    expect(h.unit('P')?.pos).toBe('0,0');
    h.cast('blink');
    expect(h.unit('P')?.pos).toBe('0,3');
  });

  it('moveTo walks a shortest open path around walls and faces its last step', () => {
    const g = square();
    const events = g.cast('travel');
    expect(events.filter((e) => e.type === 'UnitEnteredTile').map((e) => e.pos)).toEqual(['0,1', '0,2', '1,2', '2,2', '2,1']);
    expect(g.unit('P')).toMatchObject({ pos: '2,1', facing: 'n' });
  });

  it('face turns a unit', () => {
    const g = square();
    expect(types(g.cast('turn'))).toContain('UnitTurned');
    expect(g.unit('P')?.facing).toBe('s');
  });
});

describe('the basic move action', () => {
  it('lists reachable open tiles within range and moves along a path', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '1'), at('E1', 'grunt', 'e', '3')],
      tiles: { 0: 'wall' },
      config: { moveAction: { range: 2 } },
    });
    const moves = legalActions(g.rules, g.state, 'p').filter((a) => a.type === 'move');
    expect(moves.map((m) => m.to)).toEqual(['2']);
    g.act({ type: 'move', unit: 'P', to: '2' });
    expect(g.unit('P')?.pos).toBe('2');
  });

  it('allows one move per unit per turn by default', () => {
    const g = game({ placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '4')], config: { moveAction: { range: 1 } } });
    g.act({ type: 'move', unit: 'P', to: '1' });
    expect(legalActions(g.rules, g.state, 'p').some((a) => a.type === 'move')).toBe(false);
    g.act({ type: 'endTurn' });
    expect(legalActions(g.rules, g.state, 'p').filter((a) => a.type === 'move').map((a) => a.to)).toEqual(['0', '2']);
  });

  it('pays its cost and is unavailable when unaffordable', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '4')],
      config: { moveAction: { range: 1, cost: { energy: 2 }, oncePerTurn: false } },
      withCards: true,
    });
    g.act({ type: 'move', unit: 'P', to: '1' });
    expect(g.state.world.cards?.resources.p?.energy).toBe(0);
    expect(legalActions(g.rules, g.state, 'p').some((a) => a.type === 'move')).toBe(false);
  });
});

describe('combat basics', () => {
  it('block absorbs damage before HP', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '1')],
      spells: {
        guard: { source: 'P', effects: [{ op: 'gainBlock', unit: 'P', amount: 3 }] },
        hurt: { source: 'E1', effects: [{ op: 'damage', target: 'P', amount: 5 }] },
      },
    });
    g.cast('guard');
    const events = g.cast('hurt');
    expect(g.unit('P')).toMatchObject({ hp: 18, block: 0 });
    expect(types(events)).toEqual(expect.arrayContaining(['BlockLost', 'DamageDealt']));
  });

  it('deaths emit UnitDied before the unit leaves play, in board order', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '1'), at('E2', 'grunt', 'e', '2')],
      spells: { blast: { source: 'P', effects: [{ op: 'damage', target: ['E2', 'E1'], amount: 9 }] } },
    });
    const events = g.cast('blast');
    expect(events.filter((e) => ['UnitDied', 'UnitLeftPlay'].includes(e.type)).map((e) => `${e.type}:${e.unit}`)).toEqual([
      'UnitDied:E1',
      'UnitDied:E2',
      'UnitLeftPlay:E1',
      'UnitLeftPlay:E2',
    ]);
    expect(Object.keys(g.state.world.board.units)).toEqual(['P']);
  });

  it('spawns a unit on a free tile with a fresh id', () => {
    const g = game({
      placements: [at('P', 'hero', 'p', '0'), at('E1', 'grunt', 'e', '4')],
      spells: { summon: { source: 'P', effects: [{ op: 'spawn', def: 'totem', pos: '1' }] } },
    });
    const events = g.cast('summon');
    const spawned = events.find((e) => e.type === 'UnitSpawned');
    expect(spawned).toMatchObject({ def: 'totem', side: 'p', pos: '1' });
    expect(g.unit(spawned?.unit as string)).toMatchObject({ hp: 3, side: 'p' });
  });
});
