import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@ccg/content';
import {
  ContentError,
  PackageRegistry,
  apply,
  createGame,
  decidingSide,
  greedyPolicy,
  hashState,
  isPlayable,
  legalActions,
  playTurn,
  randomPolicy,
  Session,
  topologyOf,
  viewState,
  zone,
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
