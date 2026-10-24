/**
 * The standard game (decision #87): rules and setup for a content-only
 * package, built from its `ruleset` item by composing the engine's modules.
 * One player side faces an AI side whose units telegraph intents; each round
 * the enemy declares, the player takes a turn, then the enemy acts.
 */
import { HexTopology } from './board/hex.js';
import { createIntentsState, intentsModule, type IntentsWorld } from './board/intents.js';
import { LaneTopology } from './board/lane.js';
import { permanentsModule, type PermanentsWorld } from './board/permanents.js';
import { SquareTopology } from './board/square.js';
import { statusesModule } from './board/statuses.js';
import type { Topology } from './board/topology.js';
import { boardModule, boardTargeting, createBoardState, type BoardConfig, type BoardWorld } from './board/units.js';
import { createCardsState, zonesModule, type CardsWorld } from './cards/zones.js';
import type { Definitions } from './content.js';
import { ContentError } from './kernel/params.js';
import type { GameRules, GameSetup, Step } from './kernel/types.js';
import type { RulesModule } from './rules/compose.js';
import { composeRules } from './rules/compose.js';
import { logicModule } from './rules/logic.js';
import { stackModule } from './rules/stack.js';
import { Rng, seedRng } from './rng.js';

export type StandardWorld = BoardWorld & CardsWorld & IntentsWorld & PermanentsWorld;

/** A `ruleset` content item's fields (see the content schema). */
export interface RulesetDef {
  board: { topology: 'lane'; length: number } | { topology: 'square'; width: number; height: number; connectivity?: 4 | 8 } | { topology: 'hex'; radius: number };
  collision?: BoardConfig['collision'];
  bumpDamage?: number;
  edge?: BoardConfig['edge'];
  fog?: BoardConfig['fog'];
  move?: { range: number; oncePerTurn?: boolean };
  player: { side?: string; resources: Record<string, number>; handSize: number; deck: string[]; keepHand?: boolean; keepBlock?: boolean };
  enemy?: { side?: string };
  responses?: { itemAnnounced?: boolean; itemTop?: boolean };
  permanents?: { maxPerSide?: number; summoningSickness?: boolean };
  run?: { encounters: string[]; rewards?: { pool: string[]; choices?: number }; carryHp?: boolean };
  undo?: 'off' | 'turn';
}

/** What the standard game needs from a resolved game. */
export interface StandardGameInput {
  definitions: Definitions;
  /** Encounter items, in package order, with qualified ids. */
  encounters: { id: string; units: { unit: string; side: string; pos: string; facing?: string }[]; tiles?: Record<string, string>; rewards?: { cards?: string[] } }[];
  /** Saved playtest setups (#42), with qualified ids. */
  scenarios?: { id: string; encounter: string; seed: string | number; hand?: string[]; deck?: string[] }[];
  modules?: RulesModule<StandardWorld>[];
}

export function topologyOf(board: RulesetDef['board']): Topology {
  switch (board.topology) {
    case 'lane':
      return new LaneTopology(board.length);
    case 'square':
      return new SquareTopology({ width: board.width, height: board.height, ...(board.connectivity && { connectivity: board.connectivity }) });
    case 'hex':
      return HexTopology.hexagon(board.radius);
  }
}

export const sidesOf = (ruleset: RulesetDef) => ({ player: ruleset.player.side ?? 'player', enemy: ruleset.enemy?.side ?? 'enemy' });

export function standardRules(ruleset: RulesetDef, input: StandardGameInput): GameRules<StandardWorld> {
  const { definitions: defs } = input;
  const { player, enemy } = sidesOf(ruleset);
  const topology = topologyOf(ruleset.board);
  const board: BoardConfig = {
    topology,
    units: defs.units,
    tiles: defs.tiles,
    ...(ruleset.collision && { collision: ruleset.collision }),
    ...(ruleset.bumpDamage !== undefined && { bumpDamage: ruleset.bumpDamage }),
    ...(ruleset.edge && { edge: ruleset.edge }),
    ...(ruleset.fog && { fog: ruleset.fog }),
    ...(ruleset.move && { moveAction: { range: ruleset.move.range, oncePerTurn: ruleset.move.oncePerTurn ?? true } }),
  };
  const behaviors = Object.fromEntries(Object.entries(defs.units).flatMap(([id, def]) => (def.behavior ? [[id, def.behavior]] : [])));
  const intents = intentsModule<StandardWorld>({ topology, behaviors });

  return composeRules<StandardWorld>(
    {
      round: [
        intents.declarePhase(enemy),
        {
          id: 'turn',
          side: player,
          interactive: true,
          enter(ctx) {
            const world = ctx.state.world;
            // Resources refill to the turn's allowance; unspent ones do not carry over.
            const steps: Step[] = Object.entries(ruleset.player.resources).flatMap(([resource, amount]) => {
              const delta = amount - (world.cards.resources[player]?.[resource] ?? 0);
              return delta === 0 ? [] : [{ kind: 'resource', side: player, resource, delta, reason: 'refill' }];
            });
            if (!ruleset.player.keepBlock) {
              for (const u of Object.values(world.board.units)) if (u.side === player && u.block > 0) steps.push({ kind: 'loseBlock', unit: u.id, amount: u.block });
            }
            if (steps.length > 0) ctx.step(steps);
            ctx.announce({
              kind: 'rules',
              controller: player,
              source: null,
              effects: [...(ruleset.player.keepHand ? [] : [{ op: 'discardHand' }]), { op: 'draw', n: ruleset.player.handSize }],
              vars: {},
            });
          },
        },
        intents.resolvePhase(enemy),
      ],
      ...(ruleset.responses && { windows: ruleset.responses }),
      ...(ruleset.undo === 'turn' && { undo: 'turn' as const }),
      outcome(state) {
        // Passable units (traps) don't count: a side is beaten when its real units are gone.
        const sides = new Set(Object.values(state.world.board.units).filter((u) => !u.passable).map((u) => u.side));
        if (!sides.has(enemy)) return { winners: [player], reason: 'every enemy is defeated' };
        if (!sides.has(player)) return { winners: [enemy], reason: 'your units are defeated' };
        return null;
      },
    },
    [
      zonesModule<StandardWorld>(defs.cards, { targeting: boardTargeting<StandardWorld>(board) }),
      boardModule<StandardWorld>(board),
      statusesModule<StandardWorld>(defs.statuses),
      intents,
      permanentsModule<StandardWorld>({
        topology,
        cards: defs.cards,
        units: defs.units,
        ...(ruleset.permanents?.maxPerSide !== undefined && { maxPerSide: ruleset.permanents.maxPerSide }),
        ...(ruleset.permanents?.summoningSickness !== undefined && { summoningSickness: ruleset.permanents.summoningSickness }),
        targeting: (actor) => boardTargeting<StandardWorld>(board, { actor: () => actor }) as never,
      }),
      stackModule<StandardWorld>(),
      logicModule<StandardWorld>(),
      ...(input.modules ?? []),
    ],
  );
}

export interface SetupOptions {
  seed: string | number;
  encounter?: string;
  /** A saved scenario: its encounter, seed, hand and deck order replace the others. */
  scenario?: string;
  /** Cards drawn first (qualified ids), ahead of the shuffled deck, e.g. to try a card out. */
  hand?: string[];
  /** The player's deck, replacing the ruleset's (e.g. a run's deck with its rewards). */
  deck?: string[];
  /** Player units' HP by unit definition, e.g. carried between a run's encounters. */
  hp?: Record<string, number>;
}

export function standardSetup(ruleset: RulesetDef, input: StandardGameInput, options: SetupOptions): GameSetup<StandardWorld> {
  const { player, enemy } = sidesOf(ruleset);
  const scenario = options.scenario === undefined ? undefined : input.scenarios?.find((s) => s.id === options.scenario);
  if (options.scenario !== undefined && !scenario) throw new ContentError(`no scenario '${options.scenario}'`);
  const encounterId = scenario?.encounter ?? options.encounter;
  const seed = scenario?.seed ?? options.seed;
  const encounter = encounterId ? input.encounters.find((e) => e.id === encounterId) : input.encounters[0];
  if (!encounter) throw new ContentError(encounterId ? `no encounter '${encounterId}'` : 'the game has no encounters');
  // A scenario that fixes the hand or deck sets the draw pile exactly; otherwise the ruleset's deck is shuffled.
  const deck =
    scenario && (scenario.hand || scenario.deck)
      ? [...(scenario.hand ?? []), ...(scenario.deck ?? [])]
      : [...(options.hand ?? []), ...new Rng(seedRng(`deck:${seed}`)).shuffle([...(options.deck ?? ruleset.player.deck)])];
  const counts: Record<string, number> = {};
  return {
    seed,
    sides: [
      { id: player, controller: 'human' },
      { id: enemy, controller: 'ai' },
    ],
    world: {
      board: createBoardState(
        input.definitions.units,
        encounter.units.map((u) => {
          counts[u.side] = (counts[u.side] ?? 0) + 1;
          const hp = u.side === player ? options.hp?.[u.unit] : undefined;
          return { id: `${u.side}${counts[u.side]}`, def: u.unit, side: u.side, pos: u.pos, facing: u.facing ?? (u.side === player ? 'e' : 'w'), ...(hp !== undefined && { hp }) };
        }),
        encounter.tiles ?? {},
      ),
      cards: createCardsState({ [player]: deck, [enemy]: [] }),
      intents: createIntentsState(),
      permanents: {},
    },
  };
}

/** The cards offered after winning an encounter of a run: its own reward cards, else the run's pool, drawn by seed. */
export function runRewards(ruleset: RulesetDef, input: StandardGameInput, encounter: string, seed: string | number, stage: number): string[] {
  const own = input.encounters.find((e) => e.id === encounter)?.rewards?.cards;
  const pool = [...new Set(own && own.length > 0 ? own : (ruleset.run?.rewards?.pool ?? []))];
  return new Rng(seedRng(`reward:${seed}:${stage}`)).shuffle(pool).slice(0, ruleset.run?.rewards?.choices ?? 3);
}
