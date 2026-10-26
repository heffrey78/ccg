import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@ccg/content';
import {
  ContentError,
  PackageRegistry,
  cardText,
  conditionText,
  apply,
  createGame,
  decidingSide,
  greedyPolicy,
  hashState,
  isPlayable,
  legalActions,
  playTurn,
  randomPolicy,
  rulesetOf,
  runRewards,
  junctionOffer,
  runMapDepths,
  runMapIssues,
  runMapOf,
  runScenario,
  runScenarios,
  simulate,
  simulateRun,
  scaleDamage,
  summarize,
  Session,
  standardInput,
  startingStrains,
  strainsOf,
  topologyOf,
  viewState,
  zone,
  type Action,
  type RunNode,
  type GamePackage,
  type GameState,
  type RulesetDef,
  type StandardWorld,
} from '../src/index.js';

const item = (kind: ContentItem['kind'], id: string, fields: object) => ({ formatVersion: 1, kind, id, name: id, ...fields }) as ContentItem;

const RULESET: RulesetDef = {
  board: { topology: 'lane', length: 7 },
  move: { range: 1 },
  player: { resources: { energy: 3 }, handSize: 5, deck: [...Array(5).fill('strike'), ...Array(5).fill('guard')] },
};

/** A content-only game: no code at all, just items and a ruleset. */
function contentGame(ruleset: Partial<RulesetDef> = {}): GamePackage<unknown> {
  return {
    manifest: { formatVersion: 1, id: 'plain', name: 'Plain', version: '1.0.0', engine: '^0.0.0' },
    content: [
      item('card', 'strike', { cost: { energy: 1 }, targeting: { kind: 'unit', range: 1, filter: 'enemy' }, effects: [{ op: 'damage', amount: 6 }] }),
      item('card', 'guard', { cost: { energy: 1 }, targeting: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 5 }] }),
      item('unit', 'hero', { hp: 30 }),
      item('unit', 'foe', {
        hp: 20,
        behavior: {
          kind: 'if',
          cond: { kind: 'enemyWithin', range: 1 },
          then: { kind: 'intent', intent: { name: 'Hit', target: { kind: 'unit', select: 'nearestEnemy', range: 1 }, effects: [{ op: 'damage', amount: 7 }] } },
          else: { kind: 'intent', intent: { name: 'Advance', target: { kind: 'unit', select: 'nearestEnemy' }, effects: [{ op: 'approach', distance: 2 }] } },
        },
      }),
      item('encounter', 'duel', {
        units: [
          { unit: 'hero', side: 'player', pos: '0' },
          { unit: 'foe', side: 'enemy', pos: '4' },
        ],
      }),
      item('ruleset', 'main', { ...RULESET, ...ruleset }),
    ],
  };
}

function start(pkg = contentGame(), seed = 1) {
  const registry = new PackageRegistry();
  registry.register(pkg);
  const resolved = registry.resolve(pkg.manifest.id);
  if (!resolved.ok) throw new Error(resolved.issues.map((i) => `${i.file}${i.pointer}: ${i.message}`).join('\n'));
  const rules = resolved.game.createRules();
  const created = createGame(rules, resolved.game.createSetup({ seed }));
  if (!created.ok) throw new Error(created.error.message);
  return { rules, state: created.state as GameState<StandardWorld> };
}

describe('the standard game', () => {
  it('makes a content-only package with a ruleset playable', () => {
    expect(isPlayable(contentGame())).toBe(true);
    const { rules, state } = start();
    const world = state.world;
    expect(zone(world.cards, 'player', 'hand')).toHaveLength(5);
    expect(world.cards.resources.player).toEqual({ energy: 3 });
    expect(Object.values(world.board.units).map((u) => [u.def, u.pos])).toEqual([
      ['plain:hero', '0'],
      ['plain:foe', '4'],
    ]);
    // The foe telegraphs before the player's turn.
    expect(world.intents.declared.map((i) => i.name)).toEqual(['Advance']);
    expect(new Set(legalActions(rules, state, 'player').map((a) => a.type))).toEqual(new Set(['playCard', 'move', 'endTurn']));
    // The deck stays hidden from the enemy.
    const enemyView = viewState(rules, state, 'enemy');
    expect(zone(enemyView.world.cards, 'player', 'hand').every((id) => !enemyView.world.cards.instances[id])).toBe(true);
  });

  it('refills resources, resets block and redraws each turn', () => {
    const { rules, state: s0 } = start();
    const guard = legalActions(rules, s0, 'player').find((a) => a.type === 'playCard' && s0.world.cards.instances[a.card as string]?.def === 'plain:guard');
    if (!guard) throw new Error('no guard in hand');
    let s = apply(rules, s0, guard);
    if (!s.ok) throw new Error(s.error.message);
    expect(s.state.world.board.units.player1?.block).toBe(5);
    expect(s.state.world.cards.resources.player?.energy).toBe(2);
    s = apply(rules, s.state, { type: 'endTurn', side: 'player' });
    if (!s.ok) throw new Error(s.error.message);
    const next = s.state.world;
    expect(next.board.units.player1?.block).toBe(0);
    expect(next.cards.resources.player?.energy).toBe(3);
    expect(zone(next.cards, 'player', 'hand')).toHaveLength(5);
    expect(zone(next.cards, 'player', 'discard').length).toBeGreaterThan(0);
  });

  it('plays a whole encounter to an outcome', () => {
    const { rules, state: initial } = start(contentGame(), 7);
    const score = (s: GameState<StandardWorld>, side: string) =>
      Object.values(s.world.board.units).reduce((n, u) => n + (u.side === side ? u.hp + u.block : -2 * u.hp), 0) + (s.outcome?.winners.includes(side) ? 1000 : 0);
    let state = initial;
    for (let i = 0; i < 200 && !state.outcome; i++) {
      const side = decidingSide(rules, state);
      if (side === null) break;
      const result = playTurn(rules, state, side, side === 'player' ? greedyPolicy(score) : randomPolicy('ai'));
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    expect(state.outcome).toEqual({ winners: ['player'], reason: 'every enemy is defeated' });
  });

  it('builds every board topology and passes response windows through', () => {
    expect(topologyOf({ topology: 'square', width: 5, height: 4 }).positions()).toHaveLength(20);
    expect(topologyOf({ topology: 'hex', radius: 2 }).positions()).toHaveLength(19);
    const { rules } = start(contentGame({ responses: { itemAnnounced: true } }));
    expect(rules.windows).toEqual({ itemAnnounced: true });
    expect(rules.presentation?.board).toMatchObject({ kind: 'lane' });
  });

  it('a package with neither code nor a ruleset is not playable', () => {
    const pkg = contentGame();
    pkg.content = pkg.content.filter((i) => i.kind !== 'ruleset');
    expect(isPlayable(pkg)).toBe(false);
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error('should resolve');
    expect(() => resolved.game.createRules()).toThrow(ContentError);
  });

  it('a saved scenario fixes the encounter, seed, hand and deck, and always starts identically', () => {
    const pkg = contentGame();
    pkg.content.push(item('scenario', 'opening', { encounter: 'duel', seed: 'fixed', hand: ['guard', 'strike'], deck: ['strike'] }));
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error(resolved.issues[0]?.message);
    const rules = resolved.game.createRules();
    const begin = () => {
      const created = createGame(rules, resolved.game.createSetup({ seed: 'ignored', scenario: 'plain:opening' }));
      if (!created.ok) throw new Error(created.error.message);
      return created.state as GameState<StandardWorld>;
    };
    const a = begin();
    const hand = zone(a.world.cards, 'player', 'hand').map((id) => a.world.cards.instances[id]?.def);
    // Hand, then deck, are the whole draw pile: all three are drawn.
    expect(hand.sort()).toEqual(['plain:guard', 'plain:strike', 'plain:strike']);
    expect(zone(a.world.cards, 'player', 'draw')).toEqual([]);
    expect(hashState(begin())).toBe(hashState(a));
    expect(() => resolved.game.createSetup({ seed: 1, scenario: 'plain:nope' })).toThrow(/no scenario/);
  });

  it('cards to try are drawn first, ahead of the shuffled deck', () => {
    const registry = new PackageRegistry();
    registry.register(contentGame());
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error('resolve');
    const created = createGame(resolved.game.createRules(), resolved.game.createSetup({ seed: 5, hand: ['plain:guard', 'plain:guard', 'plain:guard', 'plain:guard', 'plain:guard'] }));
    if (!created.ok) throw new Error(created.error.message);
    const world = created.state.world as StandardWorld;
    expect(zone(world.cards, 'player', 'hand').map((id) => world.cards.instances[id]?.def)).toEqual(Array(5).fill('plain:guard'));
    expect(zone(world.cards, 'player', 'draw')).toHaveLength(10);
  });

  it('a run carries the deck and player HP into the next encounter, and rewards come from the pool by seed', () => {
    const pkg = contentGame({ run: { encounters: ['duel'], rewards: { pool: ['strike', 'guard'], choices: 1 } } });
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error('resolve');
    const created = createGame(resolved.game.createRules(), resolved.game.createSetup({ seed: 1, deck: ['plain:guard'], hp: { 'plain:hero': 12 } }));
    if (!created.ok) throw new Error(created.error.message);
    const world = created.state.world as StandardWorld;
    expect(world.board.units.player1?.hp).toBe(12);
    expect(world.board.units.enemy1?.hp).toBe(20);
    expect(Object.values(world.cards.instances).map((c) => c.def)).toEqual(['plain:guard']);
    const offer = runRewards(rulesetOf(resolved.game), standardInput(resolved.game), 'plain:duel', 1, 0);
    expect(offer).toHaveLength(1);
    expect(runRewards(rulesetOf(resolved.game), standardInput(resolved.game), 'plain:duel', 1, 0)).toEqual(offer);
  });

  it('a session can continue under rebuilt rules, so content edits apply to the next action', () => {
    const edited = contentGame();
    const strike = edited.content.find((i) => i.id === 'strike') as ContentItem & { effects: { amount: number }[] };
    const { rules } = start();
    const started = Session.start(rules, (() => {
      const registry = new PackageRegistry();
      registry.register(contentGame());
      const r = registry.resolve('plain');
      if (!r.ok) throw new Error('resolve');
      return r.game.createSetup({ seed: 3 });
    })());
    if (!started.ok) throw new Error(started.error.message);
    strike.effects[0]!.amount = 11;
    const registry = new PackageRegistry();
    registry.register(edited);
    const r = registry.resolve('plain');
    if (!r.ok) throw new Error('resolve');
    const session = started.session.rebind(r.game.createRules()) as unknown as Session<StandardWorld>;
    expect(session.state).toBe(started.session.state);
    expect(session.log.actions).toEqual(started.session.log.actions);
    // Walk up to the foe and strike it with the edited card.
    for (let i = 0; i < 20 && !session.state.outcome; i++) {
      const strikeAction = legalActions(session.rules, session.state, 'player').find(
        (a) => a.type === 'playCard' && session.state.world.cards.instances[a.card as string]?.def === 'plain:strike',
      );
      if (strikeAction) {
        const before = session.state.world.board.units.enemy1?.hp as number;
        const result = session.apply(strikeAction);
        if (!result.ok) throw new Error(result.error.message);
        expect(before - (session.state.world.board.units.enemy1?.hp ?? 0)).toBe(11);
        return;
      }
      const side = decidingSide(session.rules, session.state);
      const action = side === 'player' ? (legalActions(session.rules, session.state, 'player').find((a) => a.type === 'move' && a.to === String(Number(session.state.world.board.units.player1?.pos) + 1)) ?? { type: 'endTurn', side: 'player' }) : null;
      const result = action ? session.apply(action) : playTurn(session.rules, session.state, side as string, randomPolicy('x'));
      if (!result.ok) throw new Error(result.error.message);
    }
    throw new Error('never got in range to strike');
  });

  it('reports a ruleset deck card that does not exist', () => {
    const registry = new PackageRegistry();
    registry.register(contentGame({ player: { ...RULESET.player, deck: ['strike', 'missing'] } }));
    const resolved = registry.resolve('plain');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.issues.map((i) => i.message)).toContain("unknown card 'plain:missing'");
  });
});

describe('scenarios as tests', () => {
  const scenario = (id: string, fields: object) => item('scenario', id, { encounter: 'close', seed: 1, hand: ['strike'], deck: [], ...fields });
  const strike = { type: 'playCard', side: 'player', card: 'card1', target: 'enemy1' };

  function resolve(...scenarios: ContentItem[]) {
    const pkg = contentGame();
    pkg.content.push(item('encounter', 'close', { units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'foe', side: 'enemy', pos: '1' }] }), ...scenarios);
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error(resolved.issues.map((i) => `${i.file}${i.pointer}: ${i.message}`).join('\n'));
    return resolved.game;
  }

  it('replays the actions and checks every kind of expectation', () => {
    const game = resolve(
      scenario('lands', {
        actions: [strike],
        expect: [
          { kind: 'unit', unit: 'foe', hp: { min: 14, max: 14 } },
          { kind: 'unit', unit: 'hero', pos: '0' },
          { kind: 'resource', resource: 'energy', value: { min: 2, max: 2 } },
          { kind: 'cards', zone: 'discard', count: { min: 1, max: 1 } },
          { kind: 'outcome', winner: 'none' },
        ],
      }),
    );
    expect(runScenario(game, 'plain:lands')).toEqual({ id: 'plain:lands', name: 'lands', passed: true, failures: [], played: 1 });
  });

  it('reports each expectation that fails, in words', () => {
    const game = resolve(
      scenario('wrong', {
        actions: [strike],
        expect: [
          { kind: 'unit', unit: 'foe', hp: { max: 10 } },
          { kind: 'unit', unit: 'foe', alive: false },
          { kind: 'outcome', winner: 'player' },
        ],
      }),
    );
    expect(runScenario(game, 'plain:wrong').failures).toEqual([
      "expected foe's HP to be at most 10, but it is 14",
      'expected no foe on the board, but 1 remain',
      'expected the player to win, but it goes on',
    ]);
  });

  it('a recorded action that no longer works fails the scenario', () => {
    const game = resolve(scenario('stale', { actions: [{ ...strike, card: 'card9' }], expect: [{ kind: 'outcome', winner: 'none' }] }));
    expect(runScenario(game, 'plain:stale')).toMatchObject({ passed: false, played: 0 });
    expect(runScenario(game, 'plain:stale').failures[0]).toMatch(/^action 1 \(playCard by player\) can no longer be played/);
  });

  it('runs every scenario with expectations, in id order', () => {
    const game = resolve(scenario('b', { expect: [{ kind: 'outcome', winner: 'none' }] }), scenario('a', { expect: [{ kind: 'outcome', winner: 'none' }] }), scenario('setup-only', {}));
    expect(runScenarios(game).map((r) => [r.id, r.passed])).toEqual([
      ['plain:a', true],
      ['plain:b', true],
    ]);
  });
});

describe('balance simulation', () => {
  function game() {
    const registry = new PackageRegistry();
    registry.register(contentGame());
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error('resolve');
    return resolved.game;
  }
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);

  it('plays many games and summarizes them, identically for the same seeds', () => {
    const greedy = summarize(simulate(game(), { seeds, bot: 'greedy' }));
    expect(summarize(simulate(game(), { seeds, bot: 'greedy' }))).toEqual(greedy);
    expect(greedy.games).toBe(30);
    expect(greedy.wins + greedy.losses + greedy.unfinished).toBe(30);
    expect(greedy.winRate).toBeGreaterThan(0.8);
    expect(greedy.cardPlays.map(([def]) => def)).toContain('plain:strike');
    expect(greedy.damagePerResource).toBeGreaterThan(0);
    expect(Object.values(greedy.rounds).reduce((a, b) => a + b, 0)).toBe(30);
  });

  it('a random player does worse than a greedy one', () => {
    const random = summarize(simulate(game(), { seeds, bot: 'random', maxActions: 300 }));
    const greedy = summarize(simulate(game(), { seeds, bot: 'greedy' }));
    expect(random.winRate).toBeLessThan(greedy.winRate);
    // The greedy player blocks every hit; the random one gets hurt, and the foe is credited.
    expect(greedy.averageTaken).toBe(0);
    expect(random.averageTaken).toBeGreaterThan(0);
    expect(random.enemyLethality.map(([def]) => def)).toEqual(['plain:foe']);
    expect(random.enemyLethality[0]?.[1]).toBeCloseTo(random.averageTaken);
  });
});

describe('conditions on a unit’s stats (#105)', () => {
  const finisher = item('card', 'finisher', {
    targeting: { kind: 'unit', filter: 'enemy' },
    effects: [
      { op: 'readUnit' },
      { op: 'if', cond: { kind: 'compare', left: { $: 'unit.hp' }, cmp: '<=', right: 8 }, then: [{ op: 'damage', amount: 100 }] },
    ],
  });

  function play(enemy: string, hp: number) {
    const pkg = contentGame({ player: { ...RULESET.player, deck: ['finisher'], handSize: 1 } });
    pkg.content.push(finisher, item('unit', enemy, { hp }), item('encounter', 'test', { units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: enemy, side: 'enemy', pos: '1' }] }));
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error(resolved.issues[0]?.message);
    const rules = resolved.game.createRules();
    const created = createGame(rules, resolved.game.createSetup({ seed: 1, encounter: 'plain:test' }));
    if (!created.ok) throw new Error(created.error.message);
    const action = legalActions(rules, created.state, 'player').find((a) => a.type === 'playCard');
    const result = apply(rules, created.state, action!);
    if (!result.ok) throw new Error(result.error.message);
    return { state: result.state as GameState<StandardWorld>, game: resolved.game };
  }

  it('an effect branches on the target’s HP', () => {
    expect(play('weakling', 8).state.outcome?.winners).toEqual(['player']);
    expect(play('sturdy', 9).state.world.board.units.enemy1?.hp).toBe(9);
  });

  it('reads as words on the card', () => {
    const { game } = play('weakling', 8);
    expect(cardText(finisher as never, game.ops)).toBe('If its HP is at most 8: Deal 100 damage.');
    expect(conditionText({ kind: 'compare', left: { $: 'unit.stacks.plain:rot' }, cmp: '>=', right: 2 }, { name: () => 'Rot' })).toBe('its Rot stacks is at least 2');
  });
});

describe('allied units that act (#102)', () => {
  const mite = item('unit', 'mite', {
    hp: 6,
    behavior: {
      kind: 'if',
      cond: { kind: 'enemyWithin', range: 1 },
      then: { kind: 'intent', intent: { name: 'Bite', target: { kind: 'unit', select: 'nearestEnemy', range: 1 }, effects: [{ op: 'damage', amount: 4 }] } },
      else: { kind: 'intent', intent: { name: 'Creep', target: { kind: 'unit', select: 'nearestEnemy' }, effects: [{ op: 'approach', distance: 1 }] } },
    },
  });
  const zombify = item('card', 'zombify', {
    targeting: { kind: 'unit', filter: 'enemy', range: 1 },
    effects: [{ op: 'readUnit' }, { op: 'if', cond: { kind: 'compare', left: { $: 'unit.hp' }, cmp: '<=', right: 8 }, then: [{ op: 'convert' }] }],
  });

  it('a converted bug fights its former allies from the next round', () => {
    const pkg = contentGame({ player: { ...RULESET.player, deck: ['zombify', 'guard', 'guard', 'guard', 'guard'], handSize: 5 } });
    pkg.content.push(mite, zombify, item('encounter', 'swarm', { units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'mite', side: 'enemy', pos: '1' }, { unit: 'mite', side: 'enemy', pos: '2' }] }));
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error(resolved.issues[0]?.message);
    const rules = resolved.game.createRules();
    const created = createGame(rules, resolved.game.createSetup({ seed: 1, encounter: 'plain:swarm' }));
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state as GameState<StandardWorld>;
    const run = (action: Action) => {
      const result = apply(rules, state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state as GameState<StandardWorld>;
      return result.events;
    };

    const play = legalActions(rules, state, 'player').find((a) => a.type === 'playCard' && state.world.cards.instances[a.card as string]?.def === 'plain:zombify' && a.target === 'enemy1');
    const events = run(play!);
    expect(events.some((e) => e.type === 'UnitConverted' && e.unit === 'enemy1' && e.side === 'player')).toBe(true);
    expect(state.world.board.units.enemy1?.side).toBe('player');
    expect(state.world.intents.declared.some((i) => i.unit === 'enemy1')).toBe(false);

    run({ type: 'endTurn', side: 'player' });
    // Round 2: the thrall bites the other mite, and the mite bites back.
    const declared = Object.fromEntries(state.world.intents.declared.map((i) => [i.unit, [i.side, i.name, i.target]]));
    expect(declared).toEqual({ enemy1: ['player', 'Bite', 'enemy2'], enemy2: ['enemy', 'Bite', 'enemy1'] });
    run({ type: 'endTurn', side: 'player' });
    expect([state.world.board.units.enemy1?.hp, state.world.board.units.enemy2?.hp]).toEqual([2, 2]);
  });
});

describe('run maps (#100)', () => {
  const node = (id: string, kind: RunNode['kind'], next: string[], encounter?: string): RunNode => ({ id, kind, next, ...(encounter && { encounter }) });

  it('a linear run is a chain of fights ending in a boss', () => {
    expect(runMapOf({ ...RULESET, run: { encounters: ['x', 'y'] } })).toEqual({
      start: 'stage-1',
      nodes: [node('stage-1', 'fight', ['stage-2'], 'x'), node('stage-2', 'boss', [], 'y')],
    });
    expect(runMapOf(RULESET)).toBeNull();
  });

  it('finds the map’s problems and each node’s depth', () => {
    const good = { start: 'a', nodes: [node('a', 'fight', ['b', 'c'], 'e'), node('b', 'spring', ['d']), node('c', 'fight', ['d'], 'e'), node('d', 'boss', [], 'e')] };
    expect(runMapIssues(good)).toEqual([]);
    expect(Object.fromEntries(runMapDepths(good))).toEqual({ a: 0, b: 1, c: 1, d: 2 });
    const bad = { start: 's', nodes: [node('s', 'spring', ['x']), node('a', 'fight', ['a']), node('b', 'boss', [])] };
    expect(runMapIssues(bad).map((i) => `${i.pointer} ${i.message}`)).toEqual([
      "/nodes/0/next/0 there is no node 'x'",
      '/nodes/1/encounter a fight node needs an encounter',
      '/nodes/2/encounter a boss node needs an encounter',
      '/start the run must start with a fight',
      "/nodes/1/id node 'a' can't be reached from the start",
      "/nodes/2/id node 'b' can't be reached from the start",
    ]);
    expect(runMapIssues({ start: 'a', nodes: [node('a', 'fight', ['b'], 'e'), node('b', 'fight', ['a'], 'e')] }).map((i) => i.message)).toContain(
      'the map loops back on itself; every path must lead onward',
    );
  });
});

describe('strains and hybrids (#101)', () => {
  const tagged = (id: string, tags: string[], extra: object = {}) => item('card', id, { targeting: { kind: 'none' }, effects: [], tags, ...extra });
  function setup() {
    const pkg = contentGame({ run: { encounters: ['duel'], strains: ['rot', 'spore'], startStrains: 1, rewards: { pool: ['strike', 'rot1', 'rot2', 'spore1', 'hybrid'], choices: 9 } } });
    pkg.content.push(tagged('rot1', ['rot']), tagged('rot2', ['rot']), tagged('spore1', ['spore']), tagged('hybrid', ['rot', 'spore'], { requires: ['rot', 'spore'] }));
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error(resolved.issues[0]?.message);
    return { ruleset: rulesetOf(resolved.game), input: standardInput(resolved.game) };
  }
  const offer = (unlocked: string[], deck: string[]) => {
    const { ruleset, input } = setup();
    return runRewards(ruleset, input, 'plain:duel', 1, 0, { unlocked, deck: deck.map((c) => `plain:${c}`) }).map((c) => c.slice(6)).sort();
  };

  it('offers only cards whose strains are connected; hybrids once the deck holds both parents', () => {
    expect(offer([], [])).toEqual(['strike']);
    expect(offer(['rot'], [])).toEqual(['rot1', 'rot2', 'strike']);
    expect(offer(['rot', 'spore'], ['rot1'])).toEqual(['rot1', 'rot2', 'spore1', 'strike']);
    expect(offer(['rot', 'spore'], ['rot1', 'spore1'])).toEqual(['hybrid', 'rot1', 'rot2', 'spore1', 'strike']);
  });

  it('a junction offers one card from each unconnected strain; runs start with some strains connected', () => {
    const { ruleset, input } = setup();
    expect(junctionOffer(ruleset, input, ['rot'], 1, 2)).toEqual(['plain:spore1']);
    expect(junctionOffer(ruleset, input, ['rot', 'spore'], 1, 2)).toEqual([]);
    expect(junctionOffer(ruleset, input, [], 1, 2).map((c) => strainsOf(ruleset, input, c)[0]).sort()).toEqual(['rot', 'spore']);
    expect(startingStrains(ruleset, 5)).toHaveLength(1);
    expect(startingStrains(ruleset, 5)).toEqual(startingStrains(ruleset, 5));
  });
});

describe('neutral units, and revealing intents (#104, #107)', () => {
  function start(extra: ContentItem[], encounterUnits: object[], deck = ['strike']) {
    const pkg = contentGame({ player: { ...RULESET.player, deck, handSize: deck.length } });
    pkg.content.push(...extra, item('encounter', 'test', { units: encounterUnits }));
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error(resolved.issues[0]?.message);
    const rules = resolved.game.createRules();
    const created = createGame(rules, resolved.game.createSetup({ seed: 1, encounter: 'plain:test' }));
    if (!created.ok) throw new Error(created.error.message);
    return { rules, state: created.state as GameState<StandardWorld> };
  }

  it('a neutral stump is no one’s enemy and does not decide the fight, but can be hit', () => {
    const stump = item('unit', 'stump', { hp: 10 });
    const weak = item('unit', 'weak', { hp: 3 });
    const { rules, state } = start([stump, weak], [
      { unit: 'hero', side: 'player', pos: '0' },
      { unit: 'stump', side: 'neutral', pos: '1' },
      { unit: 'foe', side: 'enemy', pos: '3' },
    ]);
    // The foe heads for the hero, not the stump next to it.
    expect(state.world.intents.declared.map((i) => [i.unit, i.target])).toEqual([['enemy1', 'player1']]);
    const targets = legalActions(rules, state, 'player').filter((a) => a.type === 'playCard').map((a) => a.target);
    expect(targets).toEqual(['neutral1']);

    const won = start([weak], [
      { unit: 'hero', side: 'player', pos: '0' },
      { unit: 'weak', side: 'enemy', pos: '1' },
      { unit: 'foe', side: 'neutral', pos: '4' },
    ]);
    const strike = legalActions(won.rules, won.state, 'player').find((a) => a.type === 'playCard' && a.target === 'enemy1');
    const result = apply(won.rules, won.state, strike!);
    expect(result.ok && result.state.outcome?.winners).toEqual(['player']);
  });

  it('revealIntent shows a partial intent in full', () => {
    const sneak = item('unit', 'sneak', {
      hp: 10,
      behavior: { kind: 'intent', intent: { name: 'Ambush', visibility: 'partial', target: { kind: 'unit', select: 'nearestEnemy' }, effects: [{ op: 'damage', amount: 3 }] } },
    });
    const flare = item('card', 'flare', { targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'revealIntent' }] });
    const { rules, state } = start([sneak, flare], [
      { unit: 'hero', side: 'player', pos: '0' },
      { unit: 'sneak', side: 'enemy', pos: '3' },
    ], ['flare']);
    const before = viewState(rules, state, 'player').world.intents.declared[0];
    expect(before).toMatchObject({ name: 'Ambush', visibility: 'partial' });
    expect(before).not.toHaveProperty('target');
    const play = legalActions(rules, state, 'player').find((a) => a.type === 'playCard');
    const result = apply(rules, state, play!);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.events.some((e) => e.type === 'IntentRevealed' && e.target === 'player1')).toBe(true);
    expect(viewState(rules, result.state, 'player').world.intents.declared[0]).toMatchObject({ name: 'Ambush', target: 'player1', visibility: 'full' });
  });
});

describe('whole-run simulation', () => {
  it('plays a run to the end with a bot, the same way for the same seed', () => {
    const pkg = contentGame({ run: { encounters: ['duel', 'duel'], rewards: { pool: ['strike'], choices: 1 } } });
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error('resolve');
    const run = simulateRun(resolved.game, 3);
    expect(run).toMatchObject({ won: true, path: ['stage-1', 'stage-2'] });
    expect(run.deck.filter((c) => c === 'plain:strike')).toHaveLength(6);
    expect(simulateRun(resolved.game, 3)).toEqual(run);
  });
});

describe('difficulty levels (#125)', () => {
  const levels: RulesetDef['difficulty'] = {
    default: 'normal',
    levels: [
      { id: 'story', name: 'Story', enemyHp: 50, enemyDamage: 50, playerHp: 200 },
      { id: 'normal', name: 'Normal' },
      { id: 'hard', name: 'Hard', enemyHp: 150, enemyDamage: 143 },
    ],
  };
  const begin = (difficulty?: string) => {
    const registry = new PackageRegistry();
    registry.register(contentGame({ difficulty: levels }));
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error('resolve');
    const rules = resolved.game.createRules();
    const created = createGame(rules, resolved.game.createSetup({ seed: 1, ...(difficulty && { difficulty }) }));
    if (!created.ok) throw new Error(created.error.message);
    return { game: resolved.game, rules, state: created.state as GameState<StandardWorld> };
  };
  const hp = (state: GameState<StandardWorld>) => Object.fromEntries(Object.values(state.world.board.units).map((u) => [u.def, [u.hp, u.maxHp]]));

  it('the default level leaves the content as written', () => {
    const { state } = begin();
    expect(hp(state)).toEqual({ 'plain:hero': [30, 30], 'plain:foe': [20, 20] });
    expect(state.world.board.scale).toBeUndefined();
  });

  it('scales enemy and player HP when units are placed', () => {
    expect(hp(begin('hard').state)).toEqual({ 'plain:hero': [30, 30], 'plain:foe': [30, 30] });
    expect(hp(begin('story').state)).toEqual({ 'plain:hero': [60, 60], 'plain:foe': [10, 10] });
  });

  it('scales the damage enemy intents declare, so the telegraph shows what lands', () => {
    // Walk the hero up to the foe so it declares its 7-damage hit.
    const started = begin('hard');
    const rules = started.rules;
    let state = started.state;
    for (let i = 0; i < 4 && state.world.intents.declared[0]?.name !== 'Hit'; i++) {
      const moves = legalActions(rules, state, 'player').filter((a) => a.type === 'move');
      const next = apply(rules, state, moves.at(-1) ?? { type: 'endTurn', side: 'player' });
      if (!next.ok) throw new Error(next.error.message);
      state = next.state as GameState<StandardWorld>;
      if (moves.length > 0) {
        const ended = apply(rules, state, { type: 'endTurn', side: 'player' });
        if (!ended.ok) throw new Error(ended.error.message);
        state = ended.state as GameState<StandardWorld>;
      }
    }
    const hit = state.world.intents.declared.find((i) => i.name === 'Hit');
    expect(hit?.effects).toEqual([{ op: 'damage', amount: 10 }]);
  });

  it('scales literal damage anywhere in nested effects, keeps hits of 1 or more at least 1, and leaves other ops alone', () => {
    const effects = [{ op: 'damage', amount: 3 }, { op: 'if', then: [{ op: 'damage', amount: 1 }], else: [{ op: 'heal', amount: 4 }] }, { op: 'damage', amount: { var: 'x' } }];
    expect(scaleDamage(effects, 10)).toEqual([{ op: 'damage', amount: 1 }, { op: 'if', then: [{ op: 'damage', amount: 1 }], else: [{ op: 'heal', amount: 4 }] }, { op: 'damage', amount: { var: 'x' } }]);
    expect(scaleDamage(effects, 100)).toBe(effects);
  });

  it('rejects a level the ruleset does not have', () => {
    expect(() => begin('nightmare')).toThrow(/no difficulty 'nightmare'/);
  });

  it('simulates a run at a chosen level', () => {
    const registry = new PackageRegistry();
    registry.register(contentGame({ difficulty: levels, run: { encounters: ['duel', 'duel'] } }));
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error('resolve');
    const easy = simulateRun(resolved.game, 3, 'greedy', 1000, 'story');
    const hard = simulateRun(resolved.game, 3, 'greedy', 1000, 'hard');
    expect(easy.won).toBe(true);
    expect(easy.hp).toBeGreaterThan(hard.hp);
  });
});

describe('summoning beside the summoner (#115)', () => {
  const summoner = (count?: number) =>
    item('unit', 'foe', {
      hp: 20,
      behavior: { kind: 'intent', intent: { name: 'Brood', target: { kind: 'freeAdjacent', ...(count && { count }) }, effects: [{ op: 'spawn', def: 'grub', eachCell: true }] } },
    });
  const begin = (board: RulesetDef['board'], foePos: string, count?: number) => {
    const pkg = contentGame({ board });
    pkg.content = pkg.content.map((i) => (i.id === 'foe' ? summoner(count) : i.kind === 'encounter' ? ({ ...i, units: [{ unit: 'hero', side: 'player', pos: board.topology === 'lane' ? '0' : '0,0' }, { unit: 'foe', side: 'enemy', pos: foePos }] } as ContentItem) : i));
    pkg.content.push(item('unit', 'grub', { hp: 3 }));
    const registry = new PackageRegistry();
    registry.register(pkg);
    const resolved = registry.resolve('plain');
    if (!resolved.ok) throw new Error(resolved.issues.map((i) => i.message).join('\n'));
    const rules = resolved.game.createRules();
    const created = createGame(rules, resolved.game.createSetup({ seed: 1 }));
    if (!created.ok) throw new Error(created.error.message);
    return { rules, state: created.state as GameState<StandardWorld> };
  };
  const endTurn = (rules: ReturnType<typeof begin>['rules'], state: GameState<StandardWorld>) => {
    const next = apply(rules, state, { type: 'endTurn', side: 'player' });
    if (!next.ok) throw new Error(next.error.message);
    return next.state as GameState<StandardWorld>;
  };
  const grubs = (state: GameState<StandardWorld>) => Object.values(state.world.board.units).filter((u) => u.def === 'plain:grub').map((u) => u.pos).sort();

  it('telegraphs the tile it faces and summons there on a lane', () => {
    const { rules, state } = begin({ topology: 'lane', length: 7 }, '4');
    // The foe faces west, toward the hero: the summon goes in front of it.
    expect(state.world.intents.declared[0]).toMatchObject({ name: 'Brood', bound: 'tile', target: '3', cells: ['3'] });
    expect(grubs(endTurn(rules, state))).toEqual(['3']);
  });

  it('summons one per free neighbour up to its count, and none when boxed in', () => {
    const { rules, state } = begin({ topology: 'lane', length: 7 }, '4', 3);
    // A lane tile has two neighbours, so a count of 3 still telegraphs two.
    expect(state.world.intents.declared[0]?.cells).toEqual(['3', '5']);
    let next = endTurn(rules, state);
    expect(grubs(next)).toEqual(['3', '5']);
    // Hemmed in by its own grubs, it telegraphs nothing and summons nothing.
    expect(next.world.intents.declared.find((i) => i.name === 'Brood')?.cells).toBeUndefined();
    next = endTurn(rules, next);
    expect(grubs(next)).toEqual(['3', '5']);
  });

  it('works on a square board too', () => {
    const { rules, state } = begin({ topology: 'square', width: 5, height: 5, connectivity: 4 }, '2,2', 2);
    const cells = state.world.intents.declared[0]?.cells ?? [];
    expect(cells).toHaveLength(2);
    expect(grubs(endTurn(rules, state))).toEqual([...cells].sort());
  });
});
