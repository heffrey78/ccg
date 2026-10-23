/**
 * Scenarios as regression tests (#46): replay a scenario's recorded actions
 * from its setup and check its expectations against the final state. The
 * editor runs them as a suite, and the `ccg test` CLI runs them in CI.
 */
import type { BoardWorld } from './board/units.js';
import type { CardsWorld } from './cards/zones.js';
import { apply, createGame } from './kernel/engine.js';
import type { Action, GameState } from './kernel/types.js';
import type { ResolvedGame } from './packages/registry.js';
import { sidesOf, type RulesetDef } from './standard.js';

type Range = { min?: number; max?: number };
export type Expectation =
  | { kind: 'outcome'; winner: 'player' | 'enemy' | 'none' }
  | { kind: 'unit'; unit: string; side?: string; alive?: boolean; hp?: Range; block?: Range; pos?: string; status?: string; stacks?: Range }
  | { kind: 'cards'; zone: string; count: Range }
  | { kind: 'resource'; resource: string; value: Range };

export interface ScenarioResult {
  id: string;
  name: string;
  passed: boolean;
  failures: string[];
  /** How many of the recorded actions were played. */
  played: number;
}

type World = BoardWorld & CardsWorld;

const within = (value: number, range: Range) => (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
const rangeText = (range: Range) =>
  range.min !== undefined && range.max !== undefined
    ? range.min === range.max
      ? `${range.min}`
      : `between ${range.min} and ${range.max}`
    : range.min !== undefined
      ? `at least ${range.min}`
      : `at most ${range.max ?? '∞'}`;

/** Why each expectation does not hold in this state (empty when all hold). */
export function checkExpectations(state: GameState<World>, expectations: Expectation[], sides: { player: string; enemy: string }, name: (ref: string) => string): string[] {
  const failures: string[] = [];
  for (const e of expectations) {
    switch (e.kind) {
      case 'outcome': {
        const winner = state.outcome ? (state.outcome.winners.includes(sides.player) ? 'player' : 'enemy') : 'none';
        if (winner !== e.winner) failures.push(`expected ${e.winner === 'none' ? 'the game to go on' : `the ${e.winner} to win`}, but ${winner === 'none' ? 'it goes on' : `the ${winner} won`}`);
        break;
      }
      case 'unit': {
        const units = Object.values(state.world.board.units).filter((u) => u.def === e.unit && (e.side === undefined || u.side === e.side));
        const label = name(e.unit);
        if (e.alive === false) {
          if (units.length > 0) failures.push(`expected no ${label} on the board, but ${units.length} remain`);
          break;
        }
        if (units.length === 0) {
          failures.push(`expected a ${label} on the board, but there is none`);
          break;
        }
        for (const u of units) {
          if (e.hp && !within(u.hp, e.hp)) failures.push(`expected ${label}'s HP to be ${rangeText(e.hp)}, but it is ${u.hp}`);
          if (e.block && !within(u.block, e.block)) failures.push(`expected ${label}'s block to be ${rangeText(e.block)}, but it is ${u.block}`);
          if (e.pos !== undefined && u.pos !== e.pos) failures.push(`expected ${label} on ${e.pos}, but it is on ${u.pos}`);
          if (e.status) {
            const stacks = u.statuses[e.status] ?? 0;
            const range = e.stacks ?? { min: 1 };
            if (!within(stacks, range)) failures.push(`expected ${label} to have ${rangeText(range)} ${name(e.status)}, but it has ${stacks}`);
          }
        }
        break;
      }
      case 'cards': {
        const n = state.world.cards.zones[sides.player]?.[e.zone]?.length ?? 0;
        if (!within(n, e.count)) failures.push(`expected ${rangeText(e.count)} cards in ${e.zone}, but there are ${n}`);
        break;
      }
      case 'resource': {
        const n = state.world.cards.resources[sides.player]?.[e.resource] ?? 0;
        if (!within(n, e.value)) failures.push(`expected ${e.resource} to be ${rangeText(e.value)}, but it is ${n}`);
        break;
      }
    }
  }
  return failures;
}

interface ScenarioItem {
  id: string;
  name: string;
  actions?: Action[];
  expect?: Expectation[];
}

export function runScenario<W>(game: ResolvedGame<W>, scenarioId: string): ScenarioResult {
  const item = game.items.find((i) => i.kind === 'scenario' && i.id === scenarioId) as unknown as ScenarioItem | undefined;
  const result: ScenarioResult = { id: scenarioId, name: item?.name ?? scenarioId, passed: false, failures: [], played: 0 };
  if (!item) return { ...result, failures: [`no scenario '${scenarioId}'`] };
  try {
    const rules = game.createRules();
    const created = createGame(rules, game.createSetup({ seed: 0, scenario: scenarioId }));
    if (!created.ok) return { ...result, failures: [created.error.message] };
    let state = created.state;
    for (const [i, action] of (item.actions ?? []).entries()) {
      const next = apply(rules, state, action);
      if (!next.ok) return { ...result, failures: [`action ${i + 1} (${action.type} by ${action.side}) can no longer be played: ${next.error.message}`] };
      state = next.state;
      result.played++;
    }
    const prefix = `${game.root.id}:`;
    const ruleset = game.items.find((i) => i.kind === 'ruleset' && i.id.startsWith(prefix));
    const sides = ruleset ? sidesOf(game.definitions.rulesets[ruleset.id] as RulesetDef) : { player: 'player', enemy: 'enemy' };
    const failures = checkExpectations(state as unknown as GameState<World>, item.expect ?? [], sides, (ref) => game.name(ref) ?? ref);
    return { ...result, passed: failures.length === 0, failures };
  } catch (error) {
    return { ...result, failures: [(error as Error).message] };
  }
}

/** Every scenario in the game's own package that has expectations, in id order. */
export function runScenarios<W>(game: ResolvedGame<W>): ScenarioResult[] {
  const prefix = `${game.root.id}:`;
  return game.items
    .filter((i) => i.kind === 'scenario' && i.id.startsWith(prefix) && Array.isArray(i.expect) && i.expect.length > 0)
    .map((i) => i.id)
    .sort()
    .map((id) => runScenario(game, id));
}
