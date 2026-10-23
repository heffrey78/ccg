import { describe, expect, it } from 'vitest';
import {
  Rng,
  ZONE_VISIBILITY,
  apply,
  boardModule,
  canSee,
  composeRules,
  createBoardState,
  createCardsState,
  createGame,
  createIntentsState,
  intentsModule,
  LaneTopology,
  legalActions,
  redactEvents,
  seedRng,
  viewState,
  zone,
  zonesModule,
  type Behavior,
  type BoardWorld,
  type CardDef,
  type CardsWorld,
  type GameEvent,
  type GameRules,
  type GameState,
  type IntentsWorld,
  type SideId,
  type UnitPlacement,
} from '../src/index.js';

type World = CardsWorld & BoardWorld & IntentsWorld;

const CARDS: Record<string, CardDef> = {
  insight: { effects: [{ op: 'draw', n: 2 }] },
  toss: { effects: [{ op: 'discardHand' }] },
  dig: { effects: [{ op: 'search', def: 'gem', from: 'draw', to: 'hand' }] },
  mix: { effects: [{ op: 'shuffle', zone: 'draw' }] },
  recycle: { effects: [{ op: 'moveCard', card: { $: 'card' }, zone: 'draw', position: 'bottom' }] },
  gem: { effects: [] },
};
const DEFS = Object.keys(CARDS);
const VIEWERS: (SideId | null)[] = ['p', 'e', null];

function cardGame(seed: number) {
  const topology = new LaneTopology(6);
  const intents = intentsModule<World>({ topology, behaviors: {} });
  const rules: GameRules<World> = composeRules<World>({ round: [{ id: 'main', perSide: true, interactive: true }] }, [
    zonesModule<World>(CARDS),
    boardModule<World>({ topology, units: { hero: { hp: 10 } } }),
    intents,
  ]);
  const rng = new Rng(seedRng(`deck-${seed}`));
  const deck = () => Array.from({ length: 10 }, () => rng.pick(DEFS));
  const cards = createCardsState({ p: deck(), e: deck() });
  for (const side of ['p', 'e']) zone(cards, side, 'hand').push(...zone(cards, side, 'draw').splice(0, 4));
  const created = createGame(rules, {
    seed,
    sides: [
      { id: 'p', controller: 'human' },
      { id: 'e', controller: 'human' },
    ],
    world: { cards, board: createBoardState({ hero: { hp: 10 } }, []), intents: createIntentsState() },
  });
  if (!created.ok) throw new Error(created.error.message);
  return { rules, state: created.state };
}

/** Real ids of cards the viewer may not see, from the full state. */
function hiddenIds(state: GameState<World>, viewer: SideId | null): string[] {
  const out: string[] = [];
  for (const [side, zones] of Object.entries(state.world.cards.zones)) {
    for (const [name, ids] of Object.entries(zones)) {
      for (const id of ids) {
        const instance = state.world.cards.instances[id];
        if (!canSee(instance?.visibility ?? ZONE_VISIBILITY[name] ?? 'public', viewer, side)) out.push(id);
      }
    }
  }
  return out;
}

const CARD_EVENTS = new Set(['CardDrawn', 'CardDiscarded', 'CardExhausted', 'CardPlayed', 'CardMoved']);
const endVisible = (end: { side: string; zone: string }, viewer: SideId | null) => canSee(ZONE_VISIBILITY[end.zone] ?? 'public', viewer, end.side);

describe('views and redaction', () => {
  it('never reveal a hidden card in any view or redacted event across 1,000 random games', () => {
    // Make sure the property is exercised, not vacuously true.
    let hiddenChecked = 0;
    let eventsRedacted = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const game = cardGame(seed);
      const { rules } = game;
      let { state } = game;
      const chooser = new Rng(seedRng(`choices-${seed}`));
      for (let step = 0; step < 10; step++) {
        const side = state.turn.activeSide as SideId;
        const result = apply(rules, state, chooser.pick(legalActions(rules, state, side)));
        if (!result.ok) throw new Error(result.error.message);
        state = result.state;
        for (const viewer of VIEWERS) {
          const view = JSON.stringify(viewState(rules, state, viewer));
          for (const id of hiddenIds(state, viewer)) {
            hiddenChecked++;
            if (view.includes(`"${id}"`)) throw new Error(`seed ${seed}: ${id} visible to ${viewer}`);
          }
          const redacted = redactEvents(rules, result.events, viewer, state);
          result.events.forEach((original: GameEvent, i) => {
            if (!CARD_EVENTS.has(original.type)) return;
            const ends = [original.from, original.to] as { side: string; zone: string }[];
            if (ends.some((e) => endVisible(e, viewer))) return;
            const shown = redacted[i] as GameEvent;
            eventsRedacted++;
            expect(shown.def).toBeUndefined();
            expect(shown.card).not.toBe(original.card);
          });
        }
      }
    }
    expect(hiddenChecked).toBeGreaterThan(100_000);
    expect(eventsRedacted).toBeGreaterThan(1_000);
  }, 60_000);

  it('show the owner their hand and everyone else only placeholders', () => {
    const { rules, state } = cardGame(1);
    const own = viewState(rules, state, 'p');
    const theirs = viewState(rules, state, 'e');
    const hand = zone(state.world.cards, 'p', 'hand');
    expect(zone(own.world.cards, 'p', 'hand')).toEqual(hand);
    expect(hand.every((id) => own.world.cards.instances[id])).toBe(true);
    const seen = zone(theirs.world.cards, 'p', 'hand');
    expect(seen).toHaveLength(hand.length);
    expect(seen.some((id) => hand.includes(id) || theirs.world.cards.instances[id])).toBe(false);
    // Nobody sees the order of a draw pile, not even its owner.
    expect(zone(own.world.cards, 'p', 'draw').some((id) => own.world.cards.instances[id])).toBe(false);
  });

  it('issue fresh placeholder ids after a shuffle', () => {
    const { rules, state } = cardGame(2);
    // Put a shuffle card in p's hand.
    state.world.cards.instances.card999 = { id: 'card999', def: 'mix', owner: 'p' };
    zone(state.world.cards, 'p', 'hand').push('card999');
    const before = zone(viewState(rules, state, 'p').world.cards, 'p', 'draw');
    const after = apply(rules, state, { type: 'playCard', side: 'p', card: 'card999' });
    if (!after.ok) throw new Error(after.error.message);
    const later = zone(viewState(rules, after.state, 'p').world.cards, 'p', 'draw');
    expect(later).toHaveLength(before.length);
    expect(later.filter((id) => before.includes(id))).toEqual([]);
  });

  it('never include the random generator state, the secret, or other sides’ item variables', () => {
    const { rules, state } = cardGame(3);
    const view = viewState(rules, state, 'e');
    const text = JSON.stringify(view);
    expect(text).not.toContain(state.secret);
    expect(view).not.toHaveProperty('rng');
    state.stack.push({ id: 'item1', kind: 'card', controller: 'p', source: null, effects: [], vars: { secretPlan: 1 }, countered: false });
    expect(viewState(rules, state, 'e').stack[0]).not.toHaveProperty('vars');
    expect(viewState(rules, state, 'p').stack[0]?.vars).toEqual({ secretPlan: 1 });
  });
});

describe('hidden units and intents', () => {
  const topology = new LaneTopology(8);
  const units = { hero: { hp: 20 }, lurker: { hp: 5 } };
  const behaviors = (visibility: 'full' | 'partial' | 'hidden'): Record<string, Behavior> => ({
    lurker: { kind: 'intent', intent: { name: 'Ambush', target: { kind: 'unit', select: 'nearestEnemy' }, effects: [{ op: 'damage', amount: 3 }], visibility } },
  });
  const start = (visibility: 'full' | 'partial' | 'hidden', lurker: Partial<UnitPlacement> & { visibility?: 'owner' } = {}) => {
    const intents = intentsModule<World>({ topology, behaviors: behaviors(visibility) });
    const rules = composeRules<World>(
      { round: [intents.declarePhase('e'), { id: 'main', side: 'p', interactive: true }, intents.resolvePhase('e')] },
      [zonesModule<World>({}), boardModule<World>({ topology, units }), intents],
    );
    const board = createBoardState(units, [
      { id: 'P', def: 'hero', side: 'p', pos: '0', facing: 'e' },
      { id: 'L', def: 'lurker', side: 'e', pos: '4', facing: 'w' },
    ]);
    if (lurker.visibility && board.units.L) board.units.L.visibility = lurker.visibility;
    const created = createGame(rules, {
      seed: 'hidden',
      sides: [
        { id: 'p', controller: 'human' },
        { id: 'e', controller: 'ai' },
      ],
      world: { cards: createCardsState({ p: [], e: [] }), board, intents: createIntentsState() },
    });
    if (!created.ok) throw new Error(created.error.message);
    return { rules, ...created };
  };

  it('partial intents show only their name to the other side; hidden ones only that they exist', () => {
    const partial = start('partial');
    expect(viewState(partial.rules, partial.state, 'p').world.intents.declared).toEqual([{ id: expect.any(String), unit: 'L', side: 'e', visibility: 'partial', name: 'Ambush' }]);
    expect(viewState(partial.rules, partial.state, 'e').world.intents.declared[0]).toMatchObject({ target: 'P', effects: expect.any(Array) });
    const declared = redactEvents(partial.rules, partial.events, 'p', partial.state).find((e) => e.type === 'IntentDeclared');
    expect(declared).toMatchObject({ name: 'Ambush' });
    expect(declared).not.toHaveProperty('target');

    const hidden = start('hidden');
    expect(viewState(hidden.rules, hidden.state, 'p').world.intents.declared[0]).not.toHaveProperty('name');
    expect(redactEvents(hidden.rules, hidden.events, 'p', hidden.state).find((e) => e.type === 'IntentDeclared')).not.toHaveProperty('name');
  });

  it('a unit visible only to its owner is absent from the other side’s view and events', () => {
    const g = start('full', { visibility: 'owner' });
    expect(viewState(g.rules, g.state, 'p').world.board.units).not.toHaveProperty('L');
    expect(viewState(g.rules, g.state, 'e').world.board.units).toHaveProperty('L');
    const result = apply(g.rules, g.state, { type: 'endTurn', side: 'p' });
    if (!result.ok) throw new Error(result.error.message);
    const forP = redactEvents(g.rules, result.events, 'p', result.state);
    expect(forP.some((e) => e.unit === 'L')).toBe(false);
    // The ambush still happens: its damage to the hero is an event about the hero.
    expect(forP.some((e) => e.type === 'DamageDealt' && e.unit === 'P')).toBe(true);
  });
});
