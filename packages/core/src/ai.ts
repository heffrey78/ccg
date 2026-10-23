/**
 * AI controllers (requirement #4): a policy picks one of a side's legal
 * actions. Because the core is pure, a policy can look ahead by applying
 * actions to copies of the state; packages can plug in their own search.
 */
import { apply, legalActions, END_TURN } from './kernel/engine.js';
import type { Action, ApplyResult, GameEvent, GameRules, GameState, SideId } from './kernel/types.js';
import { viewState, type GameView } from './kernel/visibility.js';
import { Rng, seedRng } from './rng.js';

/**
 * Picks an action. A policy with full state can "cheat" (useful for harder
 * difficulty or lookahead); a fair policy gets only its side's view (#56).
 */
export type AiPolicy<W> = StatePolicy<W> | ViewPolicy<W>;

export interface StatePolicy<W> {
  fair?: false;
  choose(rules: GameRules<W>, state: GameState<W>, side: SideId, actions: Action[]): Action;
}

export interface ViewPolicy<W> {
  fair: true;
  choose(rules: GameRules<W>, view: GameView<W>, side: SideId, actions: Action[]): Action;
}

/** A policy that only ever sees its own side's view. */
export function fairPolicy<W>(choose: ViewPolicy<W>['choose']): ViewPolicy<W> {
  return { fair: true, choose };
}

/** Picks uniformly at random from its own seeded generator, so runs are repeatable. */
export function randomPolicy<W>(seed: string | number): StatePolicy<W> {
  const rng = new Rng(seedRng(seed));
  return { choose: (_rules, _state, _side, actions) => rng.pick(actions) };
}

/**
 * One-step lookahead: applies each legal action to a copy of the state and
 * picks the best-scoring result (ties go to the first, so it is deterministic).
 */
export function greedyPolicy<W>(score: (state: GameState<W>, side: SideId) => number): StatePolicy<W> {
  return {
    choose(rules, state, side, actions) {
      let best = actions[0] as Action;
      let bestScore = -Infinity;
      for (const action of actions) {
        const result = apply(rules, state, action);
        if (!result.ok) continue;
        const s = score(result.state, side);
        if (s > bestScore) {
          best = action;
          bestScore = s;
        }
      }
      return best;
    },
  };
}

/**
 * Lets a policy act for a side until it is no longer that side's decision,
 * the game ends, or `maxActions` is reached (then it ends the turn).
 */
export function playTurn<W>(
  rules: GameRules<W>,
  state: GameState<W>,
  side: SideId,
  policy: AiPolicy<W>,
  maxActions = 50,
): ApplyResult<W> {
  let current = state;
  const events: GameEvent[] = [];
  for (let i = 0; ; i++) {
    const actions = legalActions(rules, current, side);
    if (actions.length === 0) return { ok: true, state: current, events };
    const action =
      i >= maxActions
        ? { type: END_TURN, side }
        : policy.fair
          ? policy.choose(rules, viewState(rules, current, side), side, actions)
          : policy.choose(rules, current, side, actions);
    const result = apply(rules, current, action);
    if (!result.ok) return result;
    current = result.state;
    events.push(...result.events);
    if (action.type === END_TURN) return { ok: true, state: current, events };
  }
}
