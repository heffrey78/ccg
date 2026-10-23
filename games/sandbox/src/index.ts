/**
 * Sandbox: a tiny lane duel, built only on the engine's public API (#26).
 * A hero with a small deck faces a brute on a one-row board. It shows a
 * code-first game package: content from SDK helpers, a custom op, and the
 * hooks that turn the resolved packages into a playable game.
 */
import {
  LaneTopology,
  Rng,
  boardModule,
  boardTargeting,
  composeRules,
  createBoardState,
  createCardsState,
  createIntentsState,
  defineOp as defineCoreOp,
  intentsModule,
  logicModule,
  statusesModule,
  zonesModule,
  seedRng,
  type BoardConfig,
  type BoardWorld,
  type CardsWorld,
  type IntentsWorld,
} from '@ccg/core';
import { defineCard, defineEncounter, defineGame, defineStatus, defineUnit } from '@ccg/sdk';
import { z } from 'zod';

export type SandboxWorld = BoardWorld & CardsWorld & IntentsWorld;

export const PLAYER = 'hero';
export const ENEMY = 'brute';
const ENERGY = 3;
const HAND_SIZE = 4;

const content = [
  defineCard('jab', { name: 'Jab', cost: { energy: 1 }, targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'damage', amount: 4 }] }),
  defineCard('shove', { name: 'Shove', cost: { energy: 1 }, targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'push', distance: 2 }] }),
  defineCard('brace', { name: 'Brace', cost: { energy: 1 }, targeting: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 4 }] }),
  defineCard('lunge', {
    name: 'Lunge',
    cost: { energy: 1 },
    targeting: { kind: 'direction' },
    effects: [{ op: 'step', distance: 2 }, { op: 'gainBlock', amount: 1 }],
  }),
  defineCard('ember', {
    name: 'Ember',
    cost: { energy: 2 },
    keywords: ['burn'],
    targeting: { kind: 'unit', range: 3, filter: 'enemy' },
    effects: [{ op: 'damage', amount: 2 }, { op: 'applyStatus', status: 'burn', stacks: 2 }],
  }),
  defineStatus('burn', {
    name: 'Burn',
    stacking: 'intensity',
    description: 'At the start of its phase, take damage equal to stacks, then lose a stack.',
    hooks: [{ on: 'PhaseStarted', effects: [{ op: 'damage', target: { $: 'holder' }, amount: { $: 'stacks' } }, { op: 'removeStatus', status: 'burn', stacks: 1 }] }],
  }),
  defineUnit('duelist', { name: 'Duelist', hp: 24 }),
  defineUnit('brute', {
    name: 'Brute',
    hp: 18,
    behavior: {
      kind: 'if',
      cond: { kind: 'enemyWithin', range: 1 },
      then: { kind: 'intent', intent: { name: 'Smash', target: { kind: 'unit', select: 'nearestEnemy', range: 1 }, effects: [{ op: 'damage', amount: 5 }] } },
      else: { kind: 'intent', intent: { name: 'Stalk', target: { kind: 'unit', select: 'nearestEnemy' }, effects: [{ op: 'approach', distance: 2 }] } },
    },
  }),
  defineEncounter('duel', {
    name: 'Duel',
    units: [
      { unit: 'duelist', side: PLAYER, pos: '0', facing: 'e' },
      { unit: 'brute', side: ENEMY, pos: '6', facing: 'w' },
    ],
  }),
];

const DECK = ['jab', 'jab', 'jab', 'shove', 'shove', 'brace', 'brace', 'lunge', 'lunge', 'ember'];

/** Custom op: set energy back to the turn's allowance (unspent energy does not carry over). */
const refillEnergy = defineCoreOp<SandboxWorld>(
  {
    displayName: 'Refill energy',
    description: 'Set a side’s energy to an amount.',
    params: z.object({ amount: z.number().int().min(0) }),
    text: 'Refill energy to {amount}.',
    category: 'cards',
  },
  (ctx, p) => {
    const side = ctx.item.controller ?? PLAYER;
    const current = ctx.state.world.cards.resources[side]?.energy ?? 0;
    ctx.step({ kind: 'resource', side, resource: 'energy', delta: (p.amount as number) - current, reason: 'refill' });
  },
);

export default defineGame<SandboxWorld>({
  manifest: { id: 'sandbox', name: 'Sandbox Duel', version: '0.1.0', engine: '^0.0.0', description: 'A one-row duel against a brute.' },
  content,
  ops: { 'sandbox:refillEnergy': refillEnergy },

  createRules(game) {
    const board: BoardConfig = { topology: new LaneTopology(7), units: game.definitions.units };
    const intents = intentsModule<SandboxWorld>({
      topology: board.topology,
      behaviors: Object.fromEntries(
        Object.entries(game.definitions.units).flatMap(([id, def]) => (def.behavior ? [[id, def.behavior]] : [])),
      ),
    });
    return composeRules<SandboxWorld>(
      {
        round: [
          intents.declarePhase(ENEMY),
          {
            id: 'turn',
            side: PLAYER,
            interactive: true,
            enter: (ctx) =>
              ctx.announce({
                kind: 'rules',
                controller: PLAYER,
                source: null,
                effects: [{ op: 'discardHand' }, { op: 'draw', n: HAND_SIZE }, { op: 'sandbox:refillEnergy', amount: ENERGY }],
                vars: {},
              }),
          },
          intents.resolvePhase(ENEMY),
        ],
        outcome(state) {
          const sides = new Set(Object.values(state.world.board.units).map((u) => u.side));
          if (!sides.has(ENEMY)) return { winners: [PLAYER], reason: 'the brute is down' };
          if (!sides.has(PLAYER)) return { winners: [ENEMY], reason: 'the duelist fell' };
          return null;
        },
      },
      [
        zonesModule<SandboxWorld>(game.definitions.cards, { targeting: boardTargeting<SandboxWorld>(board) }),
        boardModule<SandboxWorld>(board),
        statusesModule<SandboxWorld>(game.definitions.statuses),
        intents,
        logicModule<SandboxWorld>(),
        ...game.modules,
      ],
    );
  },

  createSetup(game, { seed, encounter = 'sandbox:duel' }) {
    const placements = (game.items.find((i) => i.id === encounter)?.units ?? []) as { unit: string; side: string; pos: string; facing?: string }[];
    const deck = new Rng(seedRng(`deck:${seed}`)).shuffle(DECK.map((id) => `sandbox:${id}`));
    return {
      seed,
      sides: [
        { id: PLAYER, controller: 'human' },
        { id: ENEMY, controller: 'ai' },
      ],
      world: {
        board: createBoardState(
          game.definitions.units,
          placements.map((p, i) => ({ id: `${p.side}${i}`, def: p.unit, side: p.side, pos: p.pos, facing: p.facing ?? 'e' })),
        ),
        cards: createCardsState({ [PLAYER]: deck, [ENEMY]: [] }),
        intents: createIntentsState(),
      },
    };
  },
});

