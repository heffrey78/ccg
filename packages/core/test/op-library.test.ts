import { createContentSchemas, exportJsonSchemas } from '@ccg/content';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  LaneTopology,
  SquareTopology,
  apply,
  boardModule,
  boardTargeting,
  builtinOps,
  cardText,
  composeRules,
  createBoardState,
  createCardsState,
  createGame,
  defineOp,
  describeOps,
  legalActions,
  createIntentsState,
  intentsModule,
  logicModule,
  permanentsModule,
  stackModule,
  statusesModule,
  targetingText,
  zone,
  zonesModule,
  type Action,
  type BoardConfig,
  type BoardWorld,
  type CardDef,
  type CardsWorld,
  type GameState,
  type IntentsWorld,
  type PermanentsWorld,
  type RulesModule,
  type StatusDef,
  type UnitPlacement,
} from '../src/index.js';

type World = BoardWorld & CardsWorld & IntentsWorld & PermanentsWorld;

interface Setup {
  cards: Record<string, CardDef>;
  hand: string[];
  deck?: string[];
  placements?: UnitPlacement[];
  board?: Partial<BoardConfig>;
  extra?: RulesModule<World>[];
  statuses?: Record<string, StatusDef>;
}

const UNITS = { hero: { hp: 20 }, grunt: { hp: 6 }, wisp: { hp: 1 } };
const HERO = (pos = '0', facing = 'e'): UnitPlacement => ({ id: 'P', def: 'hero', side: 'p', pos, facing });
const GRUNT = (id: string, pos: string): UnitPlacement => ({ id, def: 'grunt', side: 'e', pos, facing: 'w' });

function game({ cards, hand, deck = [], placements = [HERO(), GRUNT('E1', '2')], board = {}, extra = [], statuses = {} }: Setup) {
  const config: BoardConfig = { topology: new LaneTopology(6), units: UNITS, ...board };
  const modules: RulesModule<World>[] = [
    zonesModule<World>(cards, { targeting: boardTargeting<World>(config) }),
    boardModule<World>(config),
    statusesModule<World>(statuses),
    intentsModule<World>({ topology: config.topology, behaviors: {} }),
    permanentsModule<World>({ topology: config.topology, cards, units: UNITS }),
    logicModule<World>(),
    stackModule<World>(),
    ...extra,
  ];
  const rules = composeRules<World>({ round: [{ id: 'main', side: 'p', interactive: true }] }, modules);
  const cardState = createCardsState({ p: [...hand, ...deck], e: [] }, { resources: { p: { energy: 3 } } });
  const draw = zone(cardState, 'p', 'draw');
  zone(cardState, 'p', 'hand').push(...draw.splice(0, hand.length));
  const created = createGame(rules, {
    seed: 'lib',
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'ai' },
    ],
    world: { board: createBoardState(UNITS, placements), cards: cardState, intents: createIntentsState(), permanents: {} },
  });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  const options = (def: string) =>
    legalActions(rules, state, 'p').filter((a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === def);
  return {
    rules,
    modules,
    get state(): GameState<World> {
      return state;
    },
    options,
    play(def: string, target?: string) {
      const action = options(def).find((a) => target === undefined || a.target === target);
      if (!action) throw new Error(`cannot play ${def}${target ? ` at ${target}` : ''}`);
      const result = apply(rules, state, action as Action);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      state = result.state;
      return result.events;
    },
    unit: (id: string) => state.world.board.units[id],
  };
}

describe('built-in op metadata', () => {
  const registry = builtinOps();

  it('describes every built-in op with a param schema and a text template', () => {
    const g = game({ cards: {}, hand: [] });
    // Internal ops run engine bookkeeping and are deliberately not usable in content.
    const internal = ['tickStatuses', 'resolveIntent', 'leavePermanent', 'tickPermanents'];
    expect(Object.keys(g.rules.ops).filter((id) => !internal.includes(id)).sort()).toEqual(registry.list().map((m) => m.id));
    for (const meta of registry.list()) {
      expect(meta.params).toBeInstanceOf(z.ZodObject);
      expect(meta.displayName.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      // Only variable-setting ops may leave no text on the card.
      if (meta.category !== 'variables') expect(meta.text.length).toBeGreaterThan(0);
    }
  });

  it('validates content effects against the built-ins, including nested branches', () => {
    const schemas = createContentSchemas(registry);
    const card = {
      formatVersion: 1,
      kind: 'card',
      id: 'gamble',
      name: 'Gamble',
      targeting: { kind: 'unit', range: 3, filter: 'enemy' },
      effects: [
        { op: 'countCards', zone: 'hand', as: 'inHand' },
        { op: 'if', cond: { kind: 'compare', left: { $: 'inHand' }, cmp: '>=', right: 2 }, then: [{ op: 'damage', amount: 5 }], else: [{ op: 'draw', n: 1 }] },
      ],
    };
    expect(schemas.card.safeParse(card).success).toBe(true);
    const bad = structuredClone(card);
    (bad.effects[1] as { then: unknown[] }).then = [{ op: 'damage', amount: -1 }];
    const issues = schemas.card.safeParse(bad).error?.issues ?? [];
    expect(issues.map((i) => i.path.join('/'))).toContain('effects/1/then/0/amount');
  });

  it('exports JSON Schema for the built-in vocabulary', () => {
    const { item, manifest } = exportJsonSchemas(createContentSchemas(registry));
    expect(JSON.stringify(item)).toContain('"moveTo"');
    expect(manifest).toHaveProperty('properties');
  });
});

describe('logic ops', () => {
  it('if runs the matching branch, with variables resolved when the branch runs', () => {
    const g = game({
      cards: {
        gamble: {
          targeting: { kind: 'unit', filter: 'enemy' },
          effects: [
            { op: 'setVar', name: 'bonus', value: 1 },
            {
              op: 'if',
              cond: { kind: 'compare', left: { $: 'handAtPlay' }, cmp: '>=', right: 1 },
              then: [{ op: 'setVar', name: 'bonus', value: 4 }, { op: 'damage', amount: { $: 'bonus' } }],
              else: [{ op: 'damage', amount: 1 }],
            },
          ],
        },
        filler: { effects: [] },
      },
      hand: ['gamble', 'filler'],
    });
    g.play('gamble', 'E1');
    expect(g.unit('E1')?.hp).toBe(2);
  });

  it('repeat runs its effects several times; not/all/any combine conditions', () => {
    const g = game({
      cards: {
        flurry: {
          targeting: { kind: 'unit', filter: 'enemy' },
          effects: [
            { op: 'repeat', times: 3, effects: [{ op: 'damage', amount: 1 }] },
            {
              op: 'if',
              cond: { kind: 'all', of: [{ kind: 'not', cond: { kind: 'truthy', value: 0 } }, { kind: 'any', of: [{ kind: 'compare', left: 1, cmp: '>', right: 2 }, { kind: 'truthy', value: 'yes' }] }] },
              then: [{ op: 'damage', amount: 1 }],
            },
          ],
        },
      },
      hand: ['flurry'],
    });
    const events = g.play('flurry', 'E1');
    expect(events.filter((e) => e.type === 'DamageDealt')).toHaveLength(4);
    expect(g.unit('E1')?.hp).toBe(2);
  });
});

describe('measuring and card ops', () => {
  it('countUnits and measureDistance store numbers for later effects', () => {
    const g = game({
      cards: {
        scale: {
          targeting: { kind: 'unit', filter: 'enemy' },
          effects: [
            { op: 'measureDistance', a: { $: 'self' }, b: { $: 'target' }, as: 'gap' },
            { op: 'countUnits', side: 'e', as: 'foes' },
            { op: 'damage', amount: { $: 'gap' } },
            { op: 'damage', amount: { $: 'foes' } },
          ],
        },
      },
      hand: ['scale'],
      placements: [HERO(), GRUNT('E1', '3'), GRUNT('E2', '5')],
    });
    g.play('scale', 'E1');
    expect(g.unit('E1')?.hp).toBe(1);
  });

  it('upgradeCard makes later plays use the upgrade', () => {
    const g = game({
      cards: {
        hone: { effects: [{ op: 'upgradeCard' }, { op: 'moveCard', card: { $: 'card' }, zone: 'hand' }], upgrade: { effects: [{ op: 'gainResource', resource: 'energy', amount: 5 }] } },
      },
      hand: ['hone'],
    });
    g.play('hone');
    expect(Object.values(g.state.world.cards.instances)[0]?.upgraded).toBe(true);
    g.play('hone');
    expect(g.state.world.cards.resources.p?.energy).toBe(8);
  });
});

describe('targeting', () => {
  const cards: Record<string, CardDef> = {
    jab: { targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'damage', amount: 2 }] },
    snipe: { targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: 1 }] },
    guard: { targeting: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 4 }] },
    leap: { targeting: { kind: 'tile', range: 2, empty: true }, effects: [{ op: 'teleport' }] },
    charge: { targeting: { kind: 'direction' }, effects: [{ op: 'step', distance: 2 }] },
    wave: { targeting: { kind: 'pattern', shape: { kind: 'line', length: 3 } }, effects: [{ op: 'damage', amount: 1 }] },
    shove: { targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'push', distance: 2 }] },
  };

  it('offers unit targets within range and filter, measured from the acting unit', () => {
    const g = game({ cards, hand: ['jab', 'snipe'], placements: [HERO('1'), GRUNT('E1', '2'), GRUNT('E2', '5')] });
    expect(g.options('jab').map((a) => a.target)).toEqual(['E1']);
    expect(g.options('snipe').map((a) => a.target)).toEqual(['E1', 'E2']);
    g.play('jab', 'E1');
    expect(g.unit('E1')?.hp).toBe(4);
  });

  it('self, tile and direction targeting bind self, target and dir', () => {
    const g = game({ cards, hand: ['guard', 'leap', 'charge'], placements: [HERO('1'), GRUNT('E1', '3')] });
    g.play('guard');
    expect(g.unit('P')?.block).toBe(4);
    // The hero's own tile is occupied, so it is not an empty tile.
    expect(g.options('leap').map((a) => a.target)).toEqual(['0', '2']);
    g.play('leap', '0');
    expect(g.unit('P')?.pos).toBe('0');
    expect(g.options('charge').map((a) => a.target)).toEqual(['e', 'w']);
    g.play('charge', 'e');
    expect(g.unit('P')?.pos).toBe('2');
  });

  it('pattern targeting hits every unit on the cells, in board order', () => {
    const g = game({ cards, hand: ['wave'], placements: [HERO('0'), GRUNT('E1', '1'), GRUNT('E2', '3'), GRUNT('E3', '5')] });
    const events = g.play('wave', 'e');
    expect(events.filter((e) => e.type === 'DamageDealt').map((e) => e.unit)).toEqual(['E1', 'E2']);
  });

  it('cards with no legal target are not playable', () => {
    const g = game({ cards, hand: ['jab'], placements: [HERO('0'), GRUNT('E1', '4')] });
    expect(g.options('jab')).toEqual([]);
  });

  it('push defaults to the target, away from the acting unit, on a square grid', () => {
    const g = game({
      cards,
      hand: ['shove'],
      placements: [HERO('1,1'), GRUNT('E1', '1,2')],
      board: { topology: new SquareTopology({ width: 4, height: 4 }) },
    });
    g.play('shove', 'E1');
    expect(g.unit('E1')?.pos).toBe('1,3');
  });
});

describe('card text', () => {
  const registry = builtinOps();

  it('renders effects, plurals, nested branches and conditions', () => {
    expect(cardText({ effects: [{ op: 'damage', amount: 6 }, { op: 'draw', n: 1 }] }, registry)).toBe('Deal 6 damage. Draw 1 card.');
    expect(cardText({ effects: [{ op: 'draw', n: 2 }, { op: 'push', distance: 1 }] }, registry)).toBe('Draw 2 cards. Push 1.');
    expect(
      cardText(
        {
          effects: [
            { op: 'countCards', zone: 'hand', as: 'n' },
            { op: 'if', cond: { kind: 'compare', left: { $: 'n' }, cmp: '>=', right: 3 }, then: [{ op: 'gainBlock', amount: 5 }] },
          ],
        },
        registry,
      ),
    ).toBe('If X is at least 3: Gain 5 block.');
    expect(cardText({ effects: [{ op: 'repeat', times: 2, effects: [{ op: 'damage', amount: { $: 'x' } }] }] }, registry)).toBe('2×: Deal X damage.');
  });

  it('prefers explicit text, and describes targeting per topology', () => {
    expect(cardText({ text: 'Custom.', effects: [{ op: 'damage', amount: 1 }] }, registry)).toBe('Custom.');
    expect(targetingText({ kind: 'unit', range: 1, filter: 'enemy' })).toBe('Target an enemy within 1.');
    expect(targetingText({ kind: 'pattern', shape: { kind: 'cone', length: 2 } })).toBe('Affects a cone of 2.');
    expect(targetingText({ kind: 'pattern', shape: { kind: 'cone', length: 2 } }, { topology: 'lane' })).toBe('Affects a line of 2.');
  });
});

describe('custom package ops', () => {
  const zapAll = defineOp<World>(
    {
      displayName: 'Zap all',
      description: 'Deal damage to every enemy unit.',
      params: z.object({ amount: z.number().int().min(0) }),
      text: 'Deal {amount} damage to every enemy.',
      widgets: { amount: 'number' },
      category: 'combat',
    },
    (ctx, p) => {
      const foes = Object.values(ctx.state.world.board.units).filter((u) => u.side !== ctx.item.controller);
      ctx.run([{ op: 'damage', target: foes.map((u) => u.id), amount: p.amount as number }]);
    },
  );
  const pack: RulesModule<World> = { name: 'storm-pack', ops: { 'storm-pack:zapAll': zapAll } };

  it('resolves in play, appears in the registry, and validates in content', () => {
    const g = game({
      cards: { storm: { effects: [{ op: 'storm-pack:zapAll', amount: 2 }] } },
      hand: ['storm'],
      placements: [HERO(), GRUNT('E1', '2'), GRUNT('E2', '4')],
      extra: [pack],
    });
    g.play('storm');
    expect([g.unit('E1')?.hp, g.unit('E2')?.hp]).toEqual([4, 4]);

    const registry = describeOps([pack], builtinOps());
    expect(registry.get('storm-pack:zapAll')?.displayName).toBe('Zap all');
    const schemas = createContentSchemas(registry);
    const effect = { op: 'storm-pack:zapAll', amount: 3 };
    expect(schemas.effect.safeParse(effect).success).toBe(true);
    expect(cardText({ effects: [effect] }, registry)).toBe('Deal 3 damage to every enemy.');
  });
});
