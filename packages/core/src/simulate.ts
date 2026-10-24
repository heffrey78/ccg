/**
 * Balance simulation (#47): plays an encounter many times with bots and
 * gathers what happened, deterministically per seed, so the same seeds
 * always give the same statistics.
 */
import { greedyPolicy, randomPolicy, type StatePolicy } from './ai.js';
import { scaledHp, type BoardWorld } from './board/units.js';
import type { CardsWorld } from './cards/zones.js';
import { apply, createGame, decidingSide, legalActions } from './kernel/engine.js';
import type { GameState, SideId } from './kernel/types.js';
import type { ResolvedGame } from './packages/registry.js';
import { Rng, seedRng } from './rng.js';
import { standardInput } from './packages/registry.js';
import {
  COMBAT_NODES,
  difficultyOf,
  difficultyScale,
  fruitingOffer,
  junctionOffer,
  runMapOf,
  runRewards,
  sidesOf,
  startingStrains,
  strainsOf,
  type RulesetDef,
  type RunCard,
  type RunNode,
} from './standard.js';

export type Bot = 'random' | 'greedy';

export interface SimOptions {
  /** The encounter to play (default: the game's first). */
  encounter?: string;
  seeds: (string | number)[];
  /** How the player side plays. The other side keeps its usual AI. */
  bot?: Bot;
  /** A game still going after this many actions counts as unfinished. */
  maxActions?: number;
  /** A difficulty level's id (#125); the ruleset's default when absent. */
  difficulty?: string;
}

export interface GameRecord {
  seed: string | number;
  winner: 'player' | 'enemy' | 'none';
  rounds: number;
  actions: number;
  /** Card definition → times the player played it. */
  cardPlays: Record<string, number>;
  /** Resources the player paid for cards. */
  spent: number;
  /** Damage the player's side dealt and took. */
  dealt: number;
  taken: number;
  /** Enemy unit definition → damage it dealt to the player's side. */
  enemyDamage: Record<string, number>;
}

type World = BoardWorld & CardsWorld;
const add = (map: Record<string, number>, key: string, n: number) => {
  map[key] = (map[key] ?? 0) + n;
};

/** A greedy score for the player: their units' HP and block, against twice the enemies' HP, and winning above all. */
function playerScore(sides: { player: SideId }) {
  return (state: GameState<World>, side: SideId) => {
    if (state.outcome) return state.outcome.winners.includes(side) ? 1e6 : -1e6;
    return Object.values(state.world.board.units).reduce((n, u) => n + (u.side === sides.player ? u.hp + u.block : -2 * u.hp), 0);
  };
}

export function simulate<W>(game: ResolvedGame<W>, options: SimOptions): GameRecord[] {
  const rules = game.createRules();
  const prefix = `${game.root.id}:`;
  const ruleset = game.items.find((i) => i.kind === 'ruleset' && i.id.startsWith(prefix));
  const sides = ruleset ? sidesOf(game.definitions.rulesets[ruleset.id] as RulesetDef) : { player: 'player', enemy: 'enemy' };
  const max = options.maxActions ?? 400;

  return options.seeds.map((seed) => {
    const record: GameRecord = { seed, winner: 'none', rounds: 0, actions: 0, cardPlays: {}, spent: 0, dealt: 0, taken: 0, enemyDamage: {} };
    const created = createGame(rules, game.createSetup({ seed, ...(options.encounter && { encounter: options.encounter }), ...(options.difficulty && { difficulty: options.difficulty }) }));
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state as unknown as GameState<World>;
    const bot: StatePolicy<World> =
      options.bot === 'greedy' ? greedyPolicy<World>(playerScore(sides)) : randomPolicy<World>(`sim:${String(seed)}`);
    const ai = randomPolicy<World>(`sim-ai:${String(seed)}`);
    /** Stack item → the unit whose intent it is. */
    const itemUnit = new Map<string, string>();

    while (!state.outcome && record.actions < max) {
      const side = decidingSide(rules as never, state);
      if (side === null) break;
      const actions = legalActions(rules as never, state, side);
      if (actions.length === 0) break;
      const action = (side === sides.player ? bot : ai).choose(rules as never, state, side, actions);
      const before = state;
      const result = apply(rules as never, state, action);
      if (!result.ok) throw new Error(`seed ${String(seed)}: ${result.error.message}`);
      state = result.state as unknown as GameState<World>;
      record.actions++;
      if (action.type === 'playCard' && side === sides.player) {
        const def = before.world.cards.instances[action.card as string]?.def;
        if (def) add(record.cardPlays, def, 1);
      }
      const defs = { ...Object.fromEntries(Object.values(before.world.board.units).map((u) => [u.id, u.def])), ...Object.fromEntries(Object.values(state.world.board.units).map((u) => [u.id, u.def])) };
      for (const e of result.events) {
        if (e.type === 'ItemAnnounced' && e.kind === 'intent' && typeof e.source === 'string') itemUnit.set(e.item as string, e.source);
        if (e.type === 'ResourceChanged' && e.side === sides.player && e.reason === 'cost') record.spent -= e.delta as number;
        if (e.type === 'DamageDealt') {
          const amount = e.amount as number;
          if (e.side === sides.player) {
            record.taken += amount;
            const attacker = typeof e.by === 'string' ? e.by : e.cause.item ? itemUnit.get(e.cause.item) : undefined;
            const def = attacker ? defs[attacker] : undefined;
            if (def) add(record.enemyDamage, def, amount);
          } else record.dealt += amount;
        }
      }
    }
    record.rounds = state.turn.round;
    if (state.outcome) record.winner = state.outcome.winners.includes(sides.player) ? 'player' : 'enemy';
    return record;
  });
}

export interface SimSummary {
  games: number;
  wins: number;
  losses: number;
  unfinished: number;
  winRate: number;
  averageRounds: number;
  /** Rounds → games that ended then. */
  rounds: Record<number, number>;
  /** Card definition → plays per game, most played first. */
  cardPlays: [string, number][];
  /** Damage dealt per resource paid. */
  damagePerResource: number;
  averageTaken: number;
  /** Enemy unit definition → damage dealt per game, most lethal first. */
  enemyLethality: [string, number][];
}

export function summarize(records: GameRecord[]): SimSummary {
  const n = Math.max(1, records.length);
  const plays: Record<string, number> = {};
  const lethality: Record<string, number> = {};
  const rounds: Record<number, number> = {};
  for (const r of records) {
    for (const [def, k] of Object.entries(r.cardPlays)) add(plays, def, k);
    for (const [def, k] of Object.entries(r.enemyDamage)) add(lethality, def, k);
    rounds[r.rounds] = (rounds[r.rounds] ?? 0) + 1;
  }
  const perGame = (map: Record<string, number>) =>
    Object.entries(map)
      .map(([k, v]) => [k, v / n] as [string, number])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const wins = records.filter((r) => r.winner === 'player').length;
  const losses = records.filter((r) => r.winner === 'enemy').length;
  const spent = records.reduce((s, r) => s + r.spent, 0);
  return {
    games: records.length,
    wins,
    losses,
    unfinished: records.length - wins - losses,
    winRate: records.length === 0 ? 0 : wins / records.length,
    averageRounds: records.reduce((s, r) => s + r.rounds, 0) / n,
    rounds,
    cardPlays: perGame(plays),
    damagePerResource: spent === 0 ? 0 : records.reduce((s, r) => s + r.dealt, 0) / spent,
    averageTaken: records.reduce((s, r) => s + r.taken, 0) / n,
    enemyLethality: perGame(lethality),
  };
}

export interface RunRecord {
  seed: string | number;
  won: boolean;
  /** Node ids entered, in order. */
  path: string[];
  /** The player's HP when the run ended. */
  hp: number;
  /** The deck at the end, by card definition. */
  deck: string[];
}

/**
 * Plays a whole run (#47, #100): fights each combat node with the bot, takes
 * the first reward or junction strain on offer, heals at springs, upgrades at
 * fruiting logs, and follows a seeded random path through the map.
 */
/** Plays a whole run with a bot; `difficulty` is a level's id (#125), the ruleset's default when absent. */
export function simulateRun<W>(game: ResolvedGame<W>, seed: string | number, bot: Bot = 'greedy', maxActions = 1000, difficulty?: string): RunRecord {
  const prefix = `${game.root.id}:`;
  const rulesetItem = game.items.find((i) => i.kind === 'ruleset' && i.id.startsWith(prefix));
  if (!rulesetItem) throw new Error('the game has no ruleset');
  const ruleset = game.definitions.rulesets[rulesetItem.id] as RulesetDef;
  const input = standardInput(game);
  const map = runMapOf(ruleset);
  if (!map) throw new Error('the ruleset has no run');
  const q = (ref: string) => (ref.includes(':') ? ref : `${prefix}${ref}`);
  const sides = sidesOf(ruleset);
  const playerScale = difficultyScale(ruleset, difficultyOf(ruleset, difficulty))[sides.player];
  const rules = game.createRules();
  const pathRng = new Rng(seedRng(`path:${String(seed)}`));
  let deck: RunCard[] = ruleset.player.deck.map((def) => ({ def: q(def) }));
  let unlocked = startingStrains(ruleset, seed);
  const hp: Record<string, number> = {};
  const record: RunRecord = { seed, won: false, path: [], hp: 0, deck: [] };
  let node: RunNode | undefined = map.nodes.find((n) => n.id === map.start);

  while (node) {
    record.path.push(node.id);
    const stage = record.path.length - 1;
    const defs = () => deck.map((c) => c.def);
    if (COMBAT_NODES.has(node.kind)) {
      const created = createGame(rules, game.createSetup({ seed: `${String(seed)}:${stage}`, encounter: q(node.encounter as string), deck, ...(Object.keys(hp).length > 0 && { hp }), ...(difficulty && { difficulty }) }));
      if (!created.ok) throw new Error(created.error.message);
      let state = created.state as unknown as GameState<World>;
      const player: StatePolicy<World> = bot === 'greedy' ? greedyPolicy<World>(playerScore(sides)) : randomPolicy<World>(`sim:${String(seed)}:${stage}`);
      const ai = randomPolicy<World>(`sim-ai:${String(seed)}:${stage}`);
      for (let n = 0; !state.outcome && n < maxActions; n++) {
        const side = decidingSide(rules as never, state);
        if (side === null) break;
        const actions = legalActions(rules as never, state, side);
        if (actions.length === 0) break;
        const result = apply(rules as never, state, (side === sides.player ? player : ai).choose(rules as never, state, side, actions));
        if (!result.ok) throw new Error(result.error.message);
        state = result.state as unknown as GameState<World>;
      }
      const mine = Object.values(state.world.board.units).filter((u) => u.side === sides.player);
      record.hp = mine.reduce((n, u) => n + u.hp, 0);
      if (!state.outcome?.winners.includes(sides.player)) return { ...record, deck: defs() };
      if (ruleset.run?.carryHp ?? true) for (const u of mine) hp[u.def] = u.hp;
      if (node.kind === 'boss' || node.next.length === 0) return { ...record, won: true, deck: defs() };
      const offer = runRewards(ruleset, input, q(node.encounter as string), seed, stage, { unlocked, deck: defs() });
      if (offer[0]) deck = [...deck, { def: offer[0] }];
    } else if (node.kind === 'junction') {
      const offer = junctionOffer(ruleset, input, unlocked, seed, stage);
      if (offer[0]) {
        deck = [...deck, { def: offer[0] }];
        unlocked = [...new Set([...unlocked, ...strainsOf(ruleset, input, offer[0])])];
      }
    } else if (node.kind === 'spring') {
      for (const [def, now] of Object.entries(hp)) {
        const max = scaledHp(game.definitions.units[def]?.hp ?? now, playerScale);
        hp[def] = Math.min(max, now + Math.ceil(max * 0.3));
      }
    } else if (node.kind === 'fruiting') {
      const hybrid = fruitingOffer(ruleset, input, { unlocked, deck: defs() }, seed, stage)[0];
      const upgradable = deck.findIndex((c) => !c.upgraded && game.definitions.cards[c.def]?.upgrade);
      if (hybrid) deck = [...deck, { def: hybrid }];
      else if (upgradable >= 0) deck = deck.map((c, i) => (i === upgradable ? { ...c, upgraded: true } : c));
    }
    const next = node.next.length === 0 ? null : pathRng.pick(node.next);
    node = next === null ? undefined : map.nodes.find((n) => n.id === next);
  }
  return { ...record, won: true, deck: deck.map((c) => c.def) };
}
