/**
 * Bridging the meta layer and encounters (#32): an encounter launch becomes a
 * standard game's setup, a finished game becomes a result, and a campaign log
 * (meta actions with each encounter's own actions) replays deterministically.
 */
import { apply, createGame } from '../kernel/engine.js';
import type { Action, GameRules, GameState } from '../kernel/types.js';
import { hashState } from '../hash.js';
import type { ResolvedGame } from '../packages/registry.js';
import type { BoardWorld } from '../board/units.js';
import { sidesOf, type RulesetDef, type SetupOptions } from '../standard.js';
import { rulesetOf } from '../packages/registry.js';
import { applyMeta, resolveEncounter, type EncounterLaunch, type EncounterResult, type MetaAction, type MetaRules, type MetaState } from './kernel.js';

/** The standard setup for a launched encounter. */
export const launchOptions = (launch: EncounterLaunch): SetupOptions => ({
  seed: launch.seed,
  encounter: launch.encounter,
  deck: launch.deck,
  ...(launch.hp && Object.keys(launch.hp).length > 0 && { hp: launch.hp }),
  ...(launch.difficulty && { difficulty: launch.difficulty }),
});

/** What a finished (or abandoned) encounter hands back to the campaign. */
export function encounterResult(ruleset: RulesetDef, state: GameState<BoardWorld>): EncounterResult {
  const { player } = sidesOf(ruleset);
  const hp: Record<string, number> = {};
  for (const u of Object.values(state.world.board.units)) if (u.side === player) hp[u.def] = Math.max(0, u.hp);
  return { won: state.outcome?.winners.includes(player) ?? false, hp, rounds: state.turn.round };
}

/** One entry of a campaign log: a meta action, or a whole encounter's actions. */
export type CampaignEntry<A extends MetaAction> = { meta: A } | { encounter: Action[] };

export interface CampaignLog<M, A extends MetaAction> {
  start: MetaState<M>;
  entries: CampaignEntry<A>[];
}

/** Replays a campaign from its log; the same log gives the same state, hash for hash. */
export function replayCampaign<M, A extends MetaAction>(
  rules: MetaRules<M, A>,
  game: ResolvedGame<unknown>,
  log: CampaignLog<M, A>,
): { ok: true; state: MetaState<M>; hashes: string[] } | { ok: false; error: string; at: number } {
  const gameRules = game.createRules() as GameRules<unknown>;
  const ruleset = rulesetOf(game);
  let state = log.start;
  const hashes: string[] = [];
  for (const [at, entry] of log.entries.entries()) {
    if ('meta' in entry) {
      const next = applyMeta(rules, state, entry.meta);
      if (!next.ok) return { ok: false, error: next.error, at };
      state = next.state;
    } else {
      if (!state.pending) return { ok: false, error: 'no encounter was launched', at };
      const created = createGame(gameRules, game.createSetup(launchOptions(state.pending)));
      if (!created.ok) return { ok: false, error: created.error.message, at };
      let played = created.state;
      for (const action of entry.encounter) {
        const result = apply(gameRules, played, action);
        if (!result.ok) return { ok: false, error: result.error.message, at };
        played = result.state;
      }
      const resolved = resolveEncounter(rules as MetaRules<M, MetaAction>, state, encounterResult(ruleset, played as GameState<BoardWorld>));
      if (!resolved.ok) return { ok: false, error: resolved.error, at };
      state = resolved.state;
    }
    hashes.push(hashState(state));
  }
  return { ok: true, state, hashes };
}
