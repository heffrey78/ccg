/**
 * Card zones, deck operations and resource costs (#21, requirement #2).
 *
 * World slice: `cards`. Every card in the game is an instance (a stable id plus
 * its definition id) that lives in exactly one zone of one side. Index 0 of a
 * zone is the top of the pile. Card definitions are static content, passed to
 * the module rather than stored in state.
 */
import { ContentError } from '../kernel/params.js';
import type { ActionDef, Effect, EffectContext, EventInput, GameState, SideId, Step } from '../kernel/types.js';
import type { RulesModule } from '../rules/compose.js';

/** Zones every side has. Packages may add more by name. */
export const ZONES = ['draw', 'hand', 'discard', 'exhaust', 'resolving'] as const;

export interface CardInstance {
  id: string;
  /** Content id of the card definition. */
  def: string;
  owner: SideId;
  upgraded?: boolean;
}

export interface CardsState {
  instances: Record<string, CardInstance>;
  /** Side → zone name → card ids, top first. */
  zones: Record<SideId, Record<string, string[]>>;
  /** Side → resource name → amount. */
  resources: Record<SideId, Record<string, number>>;
}

export interface CardsWorld {
  cards: CardsState;
}

export interface CardDef {
  cost?: Record<string, number>;
  effects: Effect[];
  /** Goes to the exhaust zone instead of discard after it resolves. */
  exhausts?: boolean;
  upgrade?: { cost?: Record<string, number>; effects?: Effect[] };
}

export interface CardsSetupOptions {
  /** Extra zone names to create for every side. */
  zones?: string[];
  resources?: Record<SideId, Record<string, number>>;
}

/** Builds the starting card state; each deck lists definition ids, top first. */
export function createCardsState(decks: Record<SideId, string[]>, options: CardsSetupOptions = {}): CardsState {
  const state: CardsState = { instances: {}, zones: {}, resources: {} };
  let n = 0;
  for (const [side, deck] of Object.entries(decks)) {
    const zones: Record<string, string[]> = {};
    for (const zone of [...ZONES, ...(options.zones ?? [])]) zones[zone] = [];
    for (const def of deck) {
      const id = `card${++n}`;
      state.instances[id] = { id, def, owner: side };
      zones.draw?.push(id);
    }
    state.zones[side] = zones;
    state.resources[side] = { ...options.resources?.[side] };
  }
  return state;
}

export interface CardLocation {
  side: SideId;
  zone: string;
  index: number;
}

export function locateCard(cards: CardsState, cardId: string): CardLocation | null {
  for (const [side, zones] of Object.entries(cards.zones)) {
    for (const [zone, ids] of Object.entries(zones)) {
      const index = ids.indexOf(cardId);
      if (index >= 0) return { side, zone, index };
    }
  }
  return null;
}

export function zone(cards: CardsState, side: SideId, name: string): string[] {
  const ids = cards.zones[side]?.[name];
  if (!ids) throw new ContentError(`side '${side}' has no zone '${name}'`);
  return ids;
}

/** The definition a card uses right now, with its upgrade applied. */
export function effectiveDef(defs: Record<string, CardDef>, card: CardInstance): CardDef {
  const def = defs[card.def];
  if (!def) throw new ContentError(`unknown card definition '${card.def}'`);
  if (!card.upgraded || !def.upgrade) return def;
  return {
    ...def,
    ...(def.upgrade.cost && { cost: def.upgrade.cost }),
    effects: def.upgrade.effects ?? def.effects,
  };
}

export function canAfford(cards: CardsState, side: SideId, cost: Record<string, number> | undefined): boolean {
  return Object.entries(cost ?? {}).every(([resource, amount]) => (cards.resources[side]?.[resource] ?? 0) >= amount);
}

/** Event type for a card move, by reason. */
const MOVE_EVENTS: Record<string, string> = {
  draw: 'CardDrawn',
  discard: 'CardDiscarded',
  exhaust: 'CardExhausted',
  play: 'CardPlayed',
};

const str = (v: unknown) => v as string;

export function zonesModule<W extends CardsWorld>(defs: Record<string, CardDef>): RulesModule<W> {
  const sideOf = (ctx: EffectContext<W>, p: Record<string, unknown>): SideId => {
    const side = (p.side as SideId | undefined) ?? ctx.item.controller;
    if (side === null || side === undefined) throw new ContentError(`op '${ctx.item.kind}' needs a side`);
    return side;
  };
  const cardsOf = (state: GameState<W>) => state.world.cards;
  const move = (card: string, toZone: string, extra: Record<string, unknown> = {}): Step => ({
    kind: 'moveCard',
    card,
    toZone,
    ...extra,
  });

  /** Moves the discard pile into the draw pile and shuffles it (empty discard: no-op). */
  const reshuffle = (ctx: EffectContext<W>, side: SideId) => {
    const discard = zone(cardsOf(ctx.state), side, 'discard').slice();
    if (discard.length === 0) return;
    ctx.step(discard.map((card) => move(card, 'draw', { position: 'bottom', reason: 'reshuffle' })));
    shuffle(ctx, side, 'draw');
  };

  const shuffle = (ctx: EffectContext<W>, side: SideId, name: string) => {
    ctx.step({ kind: 'orderZone', side, zone: name, order: ctx.rng.shuffle(zone(cardsOf(ctx.state), side, name)) });
  };

  const playCard: ActionDef<W> = {
    list(state, side) {
      const cards = cardsOf(state);
      return zone(cards, side, 'hand')
        .filter((id) => canAfford(cards, side, effectiveDef(defs, cards.instances[id] as CardInstance).cost))
        .map((card) => ({ type: 'playCard', side, card }));
    },
    perform(ctx, action) {
      const cards = cardsOf(ctx.state);
      const card = cards.instances[str(action.card)] as CardInstance;
      const def = effectiveDef(defs, card);
      const costs = Object.entries(def.cost ?? {}).filter(([, amount]) => amount > 0);
      if (costs.length > 0) {
        ctx.step(costs.map(([resource, amount]) => ({ kind: 'resource', side: action.side, resource, delta: -amount, reason: 'cost' })));
      }
      ctx.step(move(card.id, 'resolving', { reason: 'play' }));
      ctx.announce({
        kind: 'card',
        controller: action.side,
        source: card.id,
        effects: def.effects,
        vars: { card: card.id, handAtPlay: zone(cardsOf(ctx.state), action.side, 'hand').length },
      });
    },
  };

  return {
    name: 'zones',
    actions: { playCard },

    steps: {
      moveCard(state, s) {
        const cards = cardsOf(state);
        const card = str(s.card);
        const from = locateCard(cards, card);
        if (!from) throw new ContentError(`card '${card}' is not in any zone`);
        const toSide = (s.toSide as SideId | undefined) ?? from.side;
        const toZone = str(s.toZone);
        const target = zone(cards, toSide, toZone);
        zone(cards, from.side, from.zone).splice(from.index, 1);
        if (s.position === 'bottom') target.push(card);
        else target.unshift(card);
        const type = MOVE_EVENTS[str(s.reason)] ?? 'CardMoved';
        const instance = cards.instances[card] as CardInstance;
        return [
          {
            type,
            card,
            def: instance.def,
            from: { side: from.side, zone: from.zone },
            to: { side: toSide, zone: toZone },
            reason: s.reason ?? null,
          },
        ];
      },
      orderZone(state, s) {
        const ids = zone(cardsOf(state), str(s.side), str(s.zone));
        const order = s.order as string[];
        if (order.length !== ids.length || [...order].sort().join() !== [...ids].sort().join()) {
          throw new ContentError(`orderZone must keep the same cards in '${str(s.zone)}'`);
        }
        ids.splice(0, ids.length, ...order);
        return [{ type: 'ZoneShuffled', side: s.side, zone: s.zone, count: ids.length }];
      },
      resource(state, s): EventInput[] {
        const pool = (cardsOf(state).resources[str(s.side)] ??= {});
        const before = pool[str(s.resource)] ?? 0;
        const after = Math.max(0, before + (s.delta as number));
        pool[str(s.resource)] = after;
        if (after === before) return [];
        return [{ type: 'ResourceChanged', side: s.side, resource: s.resource, delta: after - before, value: after, reason: s.reason ?? null }];
      },
    },

    ops: {
      draw(ctx, p) {
        const side = sideOf(ctx, p);
        for (let i = 0; i < ((p.n as number | undefined) ?? 1); i++) {
          if (zone(cardsOf(ctx.state), side, 'draw').length === 0) reshuffle(ctx, side);
          const top = zone(cardsOf(ctx.state), side, 'draw')[0];
          if (top === undefined) return;
          ctx.step(move(top, 'hand', { reason: 'draw' }));
        }
      },
      shuffle(ctx, p) {
        shuffle(ctx, sideOf(ctx, p), (p.zone as string | undefined) ?? 'draw');
      },
      discard(ctx, p) {
        ctx.step(move(str(p.card), 'discard', { reason: 'discard' }));
      },
      discardHand(ctx, p) {
        const hand = zone(cardsOf(ctx.state), sideOf(ctx, p), 'hand').slice();
        if (hand.length > 0) ctx.step(hand.map((card) => move(card, 'discard', { reason: 'discard' })));
        ctx.setVar('discarded', { count: hand.length });
      },
      exhaust(ctx, p) {
        ctx.step(move(str(p.card), 'exhaust', { reason: 'exhaust' }));
      },
      moveCard(ctx, p) {
        ctx.step(move(str(p.card), str(p.zone), { position: p.position ?? 'top', ...(p.side !== undefined && { toSide: p.side }) }));
      },
      search(ctx, p) {
        const side = sideOf(ctx, p);
        const cards = cardsOf(ctx.state);
        const found = zone(cards, side, str(p.from ?? 'draw'))
          .filter((id) => cards.instances[id]?.def === p.def)
          .slice(0, (p.n as number | undefined) ?? 1);
        if (found.length > 0) ctx.step(found.map((card) => move(card, str(p.to ?? 'hand'))));
        ctx.setVar('found', { count: found.length });
      },
      gainResource(ctx, p) {
        ctx.step({ kind: 'resource', side: sideOf(ctx, p), resource: p.resource, delta: p.amount, reason: 'effect' });
      },
    },

    onItemResolved(ctx, item) {
      if (item.kind !== 'card' || item.source === null) return;
      const cards = cardsOf(ctx.state);
      const where = locateCard(cards, item.source);
      if (where?.zone !== 'resolving') return;
      const def = effectiveDef(defs, cards.instances[item.source] as CardInstance);
      // Not a discard: "whenever you discard" triggers must not fire for a played card.
      ctx.step(move(item.source, def.exhausts ? 'exhaust' : 'discard', { reason: def.exhausts ? 'exhaust' : 'resolved' }));
    },
  };
}
