/**
 * The worked examples from docs/design/resolution-order.md, encoded against the
 * kernel with the test lane game. Examples that need modules not built yet are
 * listed as todos naming the task that will encode them.
 */
import { describe, expect, it } from 'vitest';
import { apply, hashState, type Action, type GameEvent } from '../src/index.js';
import { ENEMY, PLAYER, laneRules, startLane, unit, world, type LaneState } from './lane-game.js';

function act(state: LaneState, action: Omit<Action, 'side'> & { side?: string }) {
  const result = apply(laneRules, state, { side: PLAYER, ...action } as Action);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

const play = (state: LaneState, card: string) => act(state, { type: 'play', card });
const types = (events: GameEvent[]) => events.map((e) => e.type);
const hp = (state: LaneState, id: string) => state.world.units[id]?.hp;

describe('resolution-order worked examples', () => {
  it('E1: a push into a hazard triggers on-damage card draw', () => {
    const state = startLane(
      world({
        length: 4,
        walls: [3],
        hazards: { 2: 2 },
        units: { P: unit('P', PLAYER, 0, 20), E1: unit('E1', ENEMY, 1, 6) },
        statuses: [{ side: PLAYER, status: 'opportunist', createdAt: 0 }],
        cards: { Shove: [{ op: 'push', unit: 'E1', distance: 2 }] },
        hand: ['Shove'],
        deck: ['Next'],
      }),
    );
    const { state: after, events } = play(state, 'Shove');

    expect(after.world.units.E1).toMatchObject({ pos: 2, hp: 3 });
    expect(after.world.hand).toEqual(['Next']);
    expect(after.world.discard).toEqual(['Shove']);
    // Terrain damage, then collision damage, then Shove resolves, then the draw.
    const order = types(events).filter((t) => ['DamageDealt', 'ItemResolved', 'CardDrawn'].includes(t));
    expect(order).toEqual(['DamageDealt', 'DamageDealt', 'ItemResolved', 'CardDrawn', 'ItemResolved']);
    expect(events.filter((e) => e.type === 'DamageDealt').map((e) => e.source)).toEqual(['terrain', 'collision']);
  });

  it('E2: lethal damage halts movement mid-push', () => {
    const state = startLane(
      world({
        length: 4,
        walls: [3],
        hazards: { 2: 2 },
        units: { P: unit('P', PLAYER, 0, 20), E1: unit('E1', ENEMY, 1, 2) },
        statuses: [{ side: PLAYER, status: 'opportunist', createdAt: 0 }],
        cards: { Shove: [{ op: 'push', unit: 'E1', distance: 2 }] },
        hand: ['Shove'],
        deck: ['Next'],
      }),
    );
    const { state: after, events } = play(state, 'Shove');

    expect(after.world.units.E1).toMatchObject({ pos: 2, dead: true });
    expect(events.filter((e) => e.type === 'DamageDealt')).toHaveLength(1);
    expect(types(events)).toContain('UnitDied');
    expect(after.world.hand).toEqual(['Next']);
  });

  it.todo('E3: a trap springs during a reaction, and the intent whiffs (#54, #57, #58)');

  it('E4: destroying an aura mid-resolution clamps HP', () => {
    const totem = unit('T', PLAYER, 1, 5, { aura: { bonus: 2, radius: 1 } });
    const state = startLane(
      world({
        units: { P: unit('P', PLAYER, 5, 20), A: unit('A', PLAYER, 0, 3, { hp: 4 }), T: totem, E1: unit('E1', ENEMY, 6, 9) },
        cards: {
          Raze: [
            { op: 'destroy', target: 'T' },
            { op: 'damageAdjacent', pos: { $: 'destroyed.pos' }, amount: 1 },
          ],
        },
        hand: ['Raze'],
      }),
    );
    // The aura is already applied after setup: A is 4/5.
    expect(state.world.units.A).toMatchObject({ hp: 4, maxHp: 5 });

    const { state: after } = play(state, 'Raze');
    expect(after.world.units.A).toMatchObject({ hp: 2, maxHp: 3 });
  });

  it('E4 (reversed order): damage first, then destroy, ends at full clamped HP', () => {
    const state = startLane(
      world({
        units: {
          P: unit('P', PLAYER, 5, 20),
          A: unit('A', PLAYER, 0, 3, { hp: 4 }),
          T: unit('T', PLAYER, 1, 5, { aura: { bonus: 2, radius: 1 } }),
          E1: unit('E1', ENEMY, 6, 9),
        },
        cards: {
          Raze: [
            { op: 'damage', target: 'A', amount: 1 },
            { op: 'destroy', target: 'T' },
          ],
        },
        hand: ['Raze'],
      }),
    );
    expect(play(state, 'Raze').state.world.units.A).toMatchObject({ hp: 3, maxHp: 3 });
  });

  it.todo('E5: a countered reaction, then the player responds again (#54, #57)');

  it('E6: simultaneous deaths resolve their death triggers in board order with last known positions', () => {
    const state = startLane(
      world({
        units: {
          P: unit('P', PLAYER, 0, 20),
          E1: unit('E1', ENEMY, 1, 2, { onDeath: [{ op: 'damageAdjacent', pos: { $: 'event.pos' }, amount: 2 }] }),
          E2: unit('E2', ENEMY, 2, 2, {
            onDeath: [{ op: 'healAdjacentAllies', pos: { $: 'event.pos' }, side: ENEMY, amount: 3 }],
          }),
          E3: unit('E3', ENEMY, 3, 8, { hp: 4 }),
        },
        cards: { Sweep: [{ op: 'damage', target: ['E1', 'E2', 'E3'], amount: 2 }] },
        hand: ['Sweep'],
      }),
    );
    const { state: after, events } = play(state, 'Sweep');

    expect(hp(after, 'P')).toBe(18);
    expect(hp(after, 'E3')).toBe(5);
    const deaths = events.filter((e) => e.type === 'UnitDied').map((e) => e.unit);
    expect(deaths).toEqual(['E1', 'E2']);
    // E1's explosion resolves before E2's heal.
    const p = events.findIndex((e) => e.type === 'DamageDealt' && e.unit === 'P');
    const heal = events.findIndex((e) => e.type === 'Healed' && e.unit === 'E3');
    expect(p).toBeGreaterThan(-1);
    expect(heal).toBeGreaterThan(p);
  });

  it('E7: block absorbs a hit fully, so on-damage triggers do not fire but on-attack triggers do', () => {
    const state = startLane(
      world({
        units: { P: unit('P', PLAYER, 0, 20, { block: 5 }), E1: unit('E1', ENEMY, 1, 10) },
        statuses: [
          { side: PLAYER, status: 'thorns', createdAt: 0 },
          { side: PLAYER, status: 'grit', createdAt: 1 },
        ],
        enemyPlan: [[{ op: 'attack', attacker: 'E1', target: 'P', amount: 5 }]],
      }),
    );
    const { state: after, events } = act(state, { type: 'endTurn' });

    expect(after.world.units.P).toMatchObject({ hp: 20, block: 0 });
    expect(after.world.energy).toBe(0);
    expect(hp(after, 'E1')).toBe(9);
    expect(types(events)).toEqual(expect.arrayContaining(['BlockLost', 'AttackBlocked', 'AttackResolved']));
    expect(events.some((e) => e.type === 'DamageDealt' && e.unit === 'P')).toBe(false);
    // Back to the player's main phase in round 2.
    expect(after.turn).toMatchObject({ round: 2, phase: 'main', activeSide: PLAYER });
  });

  // E8 (drawing past the end of the deck reshuffles mid-effect) is encoded with
  // the real zones module in src/cards/zones.test.ts.

  describe('E9: when variables are evaluated', () => {
    const setup = (effects: object[]) =>
      startLane(
        world({
          units: { P: unit('P', PLAYER, 0, 20), E1: unit('E1', ENEMY, 1, 50) },
          cards: { Purge: effects as never, a: [], b: [], c: [], d: [] },
          hand: ['Purge', 'a', 'b', 'c', 'd'],
        }),
      );

    it('a variable produced by an earlier effect deals 8', () => {
      const state = setup([
        { op: 'discardHand' },
        { op: 'damage', target: 'E1', amount: 2, times: { $: 'discarded.count' } },
      ]);
      expect(hp(play(state, 'Purge').state, 'E1')).toBe(42);
    });

    it('an onPlay snapshot deals 8', () => {
      const state = setup([
        { op: 'discardHand' },
        { op: 'damage', target: 'E1', amount: 2, times: { $: 'handAtPlay' } },
      ]);
      expect(hp(play(state, 'Purge').state, 'E1')).toBe(42);
    });

    it('a bare "cards in hand" read after the discard deals 0', () => {
      const state = setup([{ op: 'discardHand' }, { op: 'damageByHandSize', target: 'E1', per: 2 }]);
      expect(hp(play(state, 'Purge').state, 'E1')).toBe(50);
    });
  });

  describe('E10: collision rules', () => {
    const setup = (collision: 'stop' | 'bump' | 'chain', walls: number[] = []) =>
      startLane(
        world({
          length: 4,
          walls,
          collision,
          units: { P: unit('P', PLAYER, 0, 10), E1: unit('E1', ENEMY, 1, 5), E2: unit('E2', ENEMY, 2, 5) },
          cards: { Nudge: [{ op: 'push', unit: 'E1', distance: 1 }] },
          hand: ['Nudge'],
        }),
      );
    const summary = (s: LaneState) => ['E1', 'E2'].map((id) => `${id}@${s.world.units[id]?.pos}:${hp(s, id)}`);

    it('stop: nothing moves or takes damage', () => {
      expect(summary(play(setup('stop'), 'Nudge').state)).toEqual(['E1@1:5', 'E2@2:5']);
    });
    it('bump: both take 1, nothing moves', () => {
      expect(summary(play(setup('bump'), 'Nudge').state)).toEqual(['E1@1:4', 'E2@2:4']);
    });
    it('chain: the line shifts front-first with no damage', () => {
      const { state, events } = play(setup('chain'), 'Nudge');
      expect(summary(state)).toEqual(['E1@2:5', 'E2@3:5']);
      expect(events.filter((e) => e.type === 'UnitEnteredTile').map((e) => e.unit)).toEqual(['E2', 'E1']);
    });
    it('chain falls back to bump when the front is blocked', () => {
      expect(summary(play(setup('chain', [3]), 'Nudge').state)).toEqual(['E1@1:4', 'E2@2:4']);
    });
  });

  // E11 (tile-bound and unit-bound intents when the target moves) is encoded
  // with the real intents module in test/intents.test.ts.

  it('E12: an infinite trigger loop is rejected and the state is unchanged', () => {
    const state = startLane(
      world({
        units: { P: unit('P', PLAYER, 0, 20), E1: unit('E1', ENEMY, 1, 1e9), E2: unit('E2', ENEMY, 2, 1e9) },
        statuses: [{ side: PLAYER, status: 'mirror', createdAt: 0 }],
        cards: { Poke: [{ op: 'damage', target: 'E1', amount: 1 }] },
        hand: ['Poke'],
      }),
    );
    const before = hashState(state);
    const result = apply(laneRules, state, { type: 'play', side: PLAYER, card: 'Poke' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('resolution-limit');
    if (result.error.code !== 'resolution-limit') return;
    expect(result.error.trace[0]).toMatch(/^mirror:p ×\d+$/);
    expect(hashState(state)).toBe(before);
  });

  it.todo('E13: a hidden trap in fair-AI and cheating-AI views — the path choice is in test/hidden-content.test.ts; the trap springing is #58');

  it('E14: a game with no response windows never pauses', () => {
    const state = startLane(
      world({
        units: { P: unit('P', PLAYER, 0, 20), E1: unit('E1', ENEMY, 1, 10) },
        enemyPlan: [[{ op: 'attack', attacker: 'E1', target: 'P', amount: 3 }]],
      }),
    );
    const { state: after } = act(state, { type: 'endTurn' });
    expect(after.prompt).toBeNull();
    expect(after.stack).toEqual([]);
    expect(hp(after, 'P')).toBe(17);
  });
});
