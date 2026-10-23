/**
 * The 20 starter cards (#24, requirement #2): JSON content files built only
 * from built-in primitives, each with a scenario.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentSchemas, loadPackage, memorySource } from '@ccg/content';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SquareTopology,
  apply,
  boardModule,
  boardTargeting,
  buildDefinitions,
  builtinOps,
  cardText,
  composeRules,
  createBoardState,
  createCardsState,
  createGame,
  legalActions,
  logicModule,
  statusesModule,
  zone,
  zonesModule,
  type Action,
  type BoardConfig,
  type BoardWorld,
  type CardsWorld,
  type Definitions,
  type GameState,
  type UnitPlacement,
} from '../src/index.js';

type World = BoardWorld & CardsWorld;

const DIR = fileURLToPath(new URL('./fixtures/starter', import.meta.url));
let defs: Definitions;

beforeAll(async () => {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(DIR, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(DIR);
  const pkg = await loadPackage(memorySource(files), createContentSchemas(builtinOps()));
  expect(pkg.issues).toEqual([]);
  defs = buildDefinitions(pkg.items.map((i) => i.item));
});

interface Scenario {
  hand: string[];
  deck?: string[];
  units?: UnitPlacement[];
  /** Attacks the enemy makes at the start of its phase. */
  enemyAttacks?: { by: string; target: string; amount: number }[];
}

const P = (pos = '1,2', hp?: number): UnitPlacement => ({ id: 'P', def: 'hero', side: 'p', pos, facing: 'e', ...(hp && { hp }) });
const E = (id: string, pos: string, def = 'grunt'): UnitPlacement => ({ id, def, side: 'e', pos, facing: 'w' });

function scenario({ hand, deck = [], units = [P(), E('E1', '2,2')], enemyAttacks = [] }: Scenario) {
  const config: BoardConfig = { topology: new SquareTopology({ width: 5, height: 5 }), units: defs.units };
  const rules = composeRules<World>(
    {
      round: [
        { id: 'main', side: 'p', interactive: true },
        {
          id: 'enemy',
          side: 'e',
          enter(ctx) {
            for (const a of [...enemyAttacks].reverse()) {
              ctx.announce({ kind: 'intent', controller: 'e', source: a.by, effects: [{ op: 'damage', target: a.target, amount: a.amount }], vars: { self: a.by } });
            }
          },
        },
      ],
    },
    [
      zonesModule<World>(defs.cards, { targeting: boardTargeting<World>(config) }),
      boardModule<World>(config),
      statusesModule<World>(defs.statuses),
      logicModule<World>(),
    ],
  );
  const cards = createCardsState({ p: [...hand, ...deck], e: [] }, { resources: { p: { energy: 3 } } });
  zone(cards, 'p', 'hand').push(...zone(cards, 'p', 'draw').splice(0, hand.length));
  const created = createGame(rules, {
    seed: 'starter',
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'ai' },
    ],
    world: { board: createBoardState(defs.units, units), cards },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const run = (action: Action) => {
    const result = apply(rules, state, action);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    state = result.state;
    return result.events;
  };
  return {
    get state(): GameState<World> {
      return state;
    },
    targets: (def: string) =>
      legalActions(rules, state, 'p')
        .filter((a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def)
        .map((a) => a.target ?? null),
    play(def: string, target?: string) {
      const action = legalActions(rules, state, 'p').find(
        (a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def && (target === undefined || a.target === target),
      );
      if (!action) throw new Error(`cannot play ${def} at ${target}`);
      return run(action);
    },
    endTurn: () => run({ type: 'endTurn', side: 'p' }),
    unit: (id: string) => state.world.board.units[id],
    zoneDefs: (name: string) => zone(state.world.cards, 'p', name).map((c) => state.world.cards.instances[c]?.def),
    energy: () => state.world.cards.resources.p?.energy,
  };
}

describe('the starter set', () => {
  it('has 20 cards that load as content with generated text', () => {
    const registry = builtinOps();
    expect(Object.keys(defs.cards)).toHaveLength(20);
    const texts = Object.fromEntries(Object.entries(defs.cards).map(([id, card]) => [id, cardText(card, registry, { topology: 'square' })]));
    expect(texts).toMatchObject({
      strike: 'Deal 6 damage.',
      insight: 'Draw 2 cards.',
      'venom-dart': 'Apply 3 poison.',
      'desperate-strike': 'If X is at most 1: Deal 10 damage.',
    });
    for (const text of Object.values(texts)) expect(text.length).toBeGreaterThan(0);
  });
});

describe('card scenarios', () => {
  it('strike: 6 damage to an adjacent enemy, paying 1 energy', () => {
    const s = scenario({ hand: ['strike'] });
    s.play('strike', 'E1');
    expect([s.unit('E1')?.hp, s.energy()]).toEqual([4, 2]);
  });

  it('defend: 5 block', () => {
    const s = scenario({ hand: ['defend'] });
    s.play('defend');
    expect(s.unit('P')?.block).toBe(5);
  });

  it('shove: pushes the target 2 away from the hero', () => {
    const s = scenario({ hand: ['shove'] });
    s.play('shove', 'E1');
    expect(s.unit('E1')?.pos).toBe('4,2');
  });

  it('grapple: pulls a distant enemy to stop adjacent', () => {
    const s = scenario({ hand: ['grapple'], units: [P(), E('E1', '4,2')] });
    s.play('grapple', 'E1');
    expect(s.unit('E1')?.pos).toBe('2,2');
  });

  it('dash: moves the hero 2 in the chosen direction', () => {
    const s = scenario({ hand: ['dash'] });
    expect(s.targets('dash')).toEqual(['n', 'e', 's', 'w']);
    s.play('dash', 'n');
    expect(s.unit('P')?.pos).toBe('1,0');
  });

  it('whirl: hits every adjacent unit', () => {
    const s = scenario({ hand: ['whirl'], units: [P(), E('E1', '2,2'), E('E2', '1,1'), E('E3', '3,3')] });
    s.play('whirl', 'n');
    expect(['E1', 'E2', 'E3'].map((id) => s.unit(id)?.hp)).toEqual([7, 7, 10]);
  });

  it('cleave: hits a cone in front of the hero', () => {
    const s = scenario({ hand: ['cleave'], units: [P(), E('E1', '2,2'), E('E2', '3,1'), E('E3', '4,2')] });
    s.play('cleave', 'e');
    expect(['E1', 'E2', 'E3'].map((id) => s.unit(id)?.hp)).toEqual([6, 6, 10]);
  });

  it('lance: hits a line of 3', () => {
    const s = scenario({ hand: ['lance'], units: [P(), E('E1', '2,2'), E('E2', '4,2'), E('E3', '2,3')] });
    s.play('lance', 'e');
    expect(['E1', 'E2', 'E3'].map((id) => s.unit(id)?.hp)).toEqual([5, 5, 10]);
  });

  it('blink: teleports to an empty tile within 3', () => {
    const s = scenario({ hand: ['blink'] });
    expect(s.targets('blink')).not.toContain('2,2');
    s.play('blink', '3,3');
    expect(s.unit('P')?.pos).toBe('3,3');
  });

  it('trade places: swaps with a unit within 2', () => {
    const s = scenario({ hand: ['trade-places'], units: [P(), E('E1', '2,3')] });
    s.play('trade-places', 'E1');
    expect([s.unit('P')?.pos, s.unit('E1')?.pos]).toEqual(['2,3', '1,2']);
  });

  it('bulwark: 12 block, then exhausts', () => {
    const s = scenario({ hand: ['bulwark'] });
    s.play('bulwark');
    expect(s.unit('P')?.block).toBe(12);
    expect(s.zoneDefs('exhaust')).toEqual(['bulwark']);
  });

  it('insight: draws 2', () => {
    const s = scenario({ hand: ['insight'], deck: ['strike', 'defend', 'dash'] });
    s.play('insight');
    expect(s.zoneDefs('hand')).toEqual(['defend', 'strike']);
  });

  it('second wind: heals 6 up to max, then exhausts', () => {
    const s = scenario({ hand: ['second-wind'], units: [P('1,2', 20), E('E1', '4,4')] });
    s.play('second-wind');
    expect(s.unit('P')?.hp).toBe(26);
    expect(s.zoneDefs('exhaust')).toEqual(['second-wind']);
  });

  it('surge: free, gains 2 energy, then exhausts', () => {
    const s = scenario({ hand: ['surge'] });
    s.play('surge');
    expect(s.energy()).toBe(5);
    expect(s.zoneDefs('exhaust')).toEqual(['surge']);
  });

  it('venom dart: poison hits at the start of the enemy phase and decays', () => {
    const s = scenario({ hand: ['venom-dart'], units: [P(), E('E1', '3,2')] });
    s.play('venom-dart', 'E1');
    expect(s.unit('E1')?.statuses).toEqual({ poison: 3 });
    s.endTurn();
    expect(s.unit('E1')).toMatchObject({ hp: 7, statuses: { poison: 2 } });
  });

  it('expose: vulnerable takes 50% more damage and wears off with enemy phases', () => {
    const s = scenario({ hand: ['expose', 'strike'] });
    s.play('expose', 'E1');
    s.play('strike', 'E1');
    expect(s.unit('E1')?.hp).toBe(1);
    s.endTurn();
    expect(s.unit('E1')?.statuses).toEqual({ vulnerable: 1 });
  });

  it('rally: strength adds damage per stack', () => {
    const s = scenario({ hand: ['rally', 'strike'] });
    s.play('rally');
    s.play('strike', 'E1');
    expect(s.unit('E1')?.hp).toBe(2);
  });

  it('desperate strike: 10 damage with at most 1 card left in hand, else 4', () => {
    const alone = scenario({ hand: ['desperate-strike'] });
    alone.play('desperate-strike', 'E1');
    expect(alone.unit('E1')).toBeUndefined();

    const crowded = scenario({ hand: ['desperate-strike', 'defend', 'dash'] });
    crowded.play('desperate-strike', 'E1');
    expect(crowded.unit('E1')?.hp).toBe(6);
  });

  it('deploy turret: summons a friendly turret on an adjacent empty tile', () => {
    const s = scenario({ hand: ['deploy-turret'] });
    const events = s.play('deploy-turret', '1,1');
    const turret = s.unit(events.find((e) => e.type === 'UnitSpawned')?.unit as string);
    expect(turret).toMatchObject({ def: 'turret', side: 'p', pos: '1,1', hp: 6 });
  });

  it('thornmail: an attacker takes damage equal to the thorns stacks', () => {
    const s = scenario({ hand: ['thornmail'], enemyAttacks: [{ by: 'E1', target: 'P', amount: 4 }] });
    s.play('thornmail');
    s.endTurn();
    expect([s.unit('P')?.hp, s.unit('E1')?.hp]).toEqual([26, 8]);
  });
});
