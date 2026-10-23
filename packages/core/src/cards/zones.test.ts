import { describe, expect, it } from 'vitest';
import { hashState } from '../hash.js';
import { apply, createGame, legalActions } from '../kernel/engine.js';
import type { Action, GameEvent, GameState } from '../kernel/types.js';
import { composeRules } from '../rules/compose.js';
import { createCardsState, zone, zonesModule, type CardDef, type CardsSetupOptions, type CardsWorld } from './zones.js';

const DEFS: Record<string, CardDef> = {
  insight: { cost: { energy: 1 }, effects: [{ op: 'draw', n: 3 }] },
  purge: { cost: { energy: 2 }, effects: [{ op: 'discardHand' }] },
  burnout: { cost: { energy: 0 }, effects: [{ op: 'gainResource', resource: 'energy', amount: 2 }], exhausts: true },
  tutor: { effects: [{ op: 'search', def: 'gem', from: 'draw', to: 'hand' }] },
  recall: { effects: [{ op: 'moveCard', card: { $: 'card' }, zone: 'draw', position: 'bottom' }] },
  gem: { cost: { energy: 3 }, effects: [] },
  filler: { effects: [] },
};

const rules = composeRules<CardsWorld>({ round: [{ id: 'main', side: 'p', interactive: true }] }, [zonesModule(DEFS)]);

function start(deck: string[], setup: (w: CardsWorld) => void = () => {}, options: CardsSetupOptions = {}, seed = 's') {
  const cards = createCardsState({ p: deck }, { resources: { p: { energy: 3 } }, ...options });
  const world = { cards };
  setup(world);
  const result = createGame(rules, { seed, sides: [{ id: 'p', controller: 'human' }], world });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

/** Moves cards (by definition, from the top of the draw pile) into a zone during setup. */
function put(world: CardsWorld, defs: string[], to: string) {
  for (const def of defs) {
    const draw = zone(world.cards, 'p', 'draw');
    const id = draw.find((c) => world.cards.instances[c]?.def === def) as string;
    draw.splice(draw.indexOf(id), 1);
    zone(world.cards, 'p', to).push(id);
  }
}

function play(state: GameState<CardsWorld>, def: string) {
  const card = zone(state.world.cards, 'p', 'hand').find((c) => state.world.cards.instances[c]?.def === def);
  const result = apply(rules, state, { type: 'playCard', side: 'p', card } as Action);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

const defsIn = (state: GameState<CardsWorld>, name: string) =>
  zone(state.world.cards, 'p', name).map((c) => state.world.cards.instances[c]?.def);
const types = (events: GameEvent[]) => events.map((e) => e.type);

describe('E8: drawing past the end of the deck reshuffles mid-effect', () => {
  const setup = (seed: string) =>
    start(['insight', 'filler', 'filler', 'filler', 'filler', 'filler'], (w) => {
      put(w, ['insight'], 'hand');
      put(w, ['filler', 'filler', 'filler', 'filler'], 'discard');
    }, {}, seed);

  it('reshuffles the discard pile (not the card being played) and keeps drawing', () => {
    const { state, events } = play(setup('one'), 'insight');
    expect(zone(state.world.cards, 'p', 'hand')).toHaveLength(3);
    expect(zone(state.world.cards, 'p', 'draw')).toHaveLength(2);
    expect(defsIn(state, 'discard')).toEqual(['insight']);
    expect(types(events).filter((t) => ['CardDrawn', 'ZoneShuffled'].includes(t))).toEqual([
      'CardDrawn',
      'ZoneShuffled',
      'CardDrawn',
      'CardDrawn',
    ]);
  });

  it('draws the same cards for the same seed', () => {
    const a = play(setup('same'), 'insight').state;
    const b = play(setup('same'), 'insight').state;
    expect(zone(a.world.cards, 'p', 'hand')).toEqual(zone(b.world.cards, 'p', 'hand'));
    expect(hashState(a)).toBe(hashState(b));
  });
});

describe('costs and legality', () => {
  it('lists only affordable cards and pays the cost when played', () => {
    const state = start(['insight', 'gem', 'filler', 'filler'], (w) => put(w, ['insight', 'gem'], 'hand'));
    state.world.cards.resources.p = { energy: 2 };
    const playable = legalActions(rules, state, 'p').filter((a) => a.type === 'playCard');
    expect(playable.map((a) => state.world.cards.instances[a.card as string]?.def)).toEqual(['insight']);

    const { state: after, events } = play(state, 'insight');
    expect(after.world.cards.resources.p?.energy).toBe(1);
    expect(events[0]).toMatchObject({ type: 'ResourceChanged', resource: 'energy', delta: -1, value: 1, reason: 'cost' });
  });

  it('rejects playing an unaffordable card', () => {
    const state = start(['gem'], (w) => put(w, ['gem'], 'hand'));
    state.world.cards.resources.p = { energy: 1 };
    const card = zone(state.world.cards, 'p', 'hand')[0];
    expect(apply(rules, state, { type: 'playCard', side: 'p', card })).toMatchObject({ ok: false, error: { code: 'illegal-action' } });
  });
});

describe('zone ops and their events', () => {
  it('a played card moves hand → resolving → discard, without counting as a discard', () => {
    const state = start(['filler'], (w) => put(w, ['filler'], 'hand'));
    const { state: after, events } = play(state, 'filler');
    expect(types(events)).toEqual(['CardPlayed', 'ItemAnnounced', 'ItemResolving', 'CardMoved', 'ItemResolved']);
    expect(events[3]).toMatchObject({ reason: 'resolved', to: { zone: 'discard' } });
    expect(defsIn(after, 'discard')).toEqual(['filler']);
  });

  it('exhausting cards go to exhaust; gainResource changes the pool', () => {
    const state = start(['burnout'], (w) => put(w, ['burnout'], 'hand'));
    const { state: after, events } = play(state, 'burnout');
    expect(defsIn(after, 'exhaust')).toEqual(['burnout']);
    expect(after.world.cards.resources.p?.energy).toBe(5);
    expect(types(events)).toContain('CardExhausted');
    expect(events.find((e) => e.type === 'ResourceChanged')).toMatchObject({ delta: 2, value: 5, reason: 'effect' });
  });

  it('discardHand discards every card and reports the count', () => {
    const state = start(['purge', 'filler', 'filler', 'filler'], (w) => put(w, ['purge', 'filler', 'filler'], 'hand'));
    const { state: after, events } = play(state, 'purge');
    expect(zone(after.world.cards, 'p', 'hand')).toEqual([]);
    expect(events.filter((e) => e.type === 'CardDiscarded')).toHaveLength(2);
    // Both discards land on top, then Purge goes on top once it resolves.
    expect(defsIn(after, 'discard')).toEqual(['purge', 'filler', 'filler']);
  });

  it('search moves the first matching card from the draw pile to hand', () => {
    const state = start(['tutor', 'filler', 'gem', 'gem'], (w) => put(w, ['tutor'], 'hand'));
    const { state: after, events } = play(state, 'tutor');
    expect(defsIn(after, 'hand')).toEqual(['gem']);
    expect(defsIn(after, 'draw')).toEqual(['filler', 'gem']);
    expect(events.find((e) => e.type === 'CardMoved' && e.reason === null)).toMatchObject({
      from: { zone: 'draw' },
      to: { zone: 'hand' },
    });
  });

  it('moveCard can put a card on the bottom of a pile', () => {
    const state = start(['recall', 'filler', 'filler'], (w) => put(w, ['recall'], 'hand'));
    const { state: after } = play(state, 'recall');
    expect(defsIn(after, 'draw')).toEqual(['filler', 'filler', 'recall']);
    expect(defsIn(after, 'discard')).toEqual([]);
  });

  it('drawing from an empty deck and discard draws nothing', () => {
    const state = start(['insight'], (w) => put(w, ['insight'], 'hand'));
    const { state: after, events } = play(state, 'insight');
    expect(zone(after.world.cards, 'p', 'hand')).toEqual([]);
    expect(types(events)).not.toContain('CardDrawn');
  });

  it('supports package-defined zones', () => {
    const state = start(['filler'], () => {}, { zones: ['graveyard'] });
    expect(zone(state.world.cards, 'p', 'graveyard')).toEqual([]);
    expect(() => zone(state.world.cards, 'p', 'nowhere')).toThrow(/no zone/);
  });
});

describe('composeRules', () => {
  it('rejects two modules defining the same op', () => {
    expect(() => composeRules<CardsWorld>({ round: [{ id: 'm', side: 'p', interactive: true }], ops: { draw: () => {} } }, [zonesModule(DEFS)])).toThrow(
      /op 'draw' is defined by both zones and game/,
    );
  });
});
