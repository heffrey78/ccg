/**
 * Card zones, deck operations and resource costs (#21, requirement #2).
 *
 * World slice: `cards`. Every card in the game is an instance (a stable id plus
 * its definition id) that lives in exactly one zone of one side. Index 0 of a
 * zone is the top of the pile. Card definitions are static content, passed to
 * the module rather than stored in state.
 */
import type { Targeting } from '@ccg/content';
import { z } from 'zod';
import { ContentError } from '../kernel/params.js';
import type { ActionDef, Effect, EffectContext, EventInput, GameState, SideId, Step } from '../kernel/types.js';
import { defineOp, type RulesModule } from '../rules/compose.js';

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
  targeting?: Targeting;
  effects: Effect[];
  /** Goes to the exhaust zone instead of discard after it resolves. */
  exhausts?: boolean;
  upgrade?: { cost?: Record<string, number>; effects?: Effect[] };
}

/**
 * Turns a card's targeting into legal choices and the variables its effects
 * see. The board module supplies one (`boardTargeting`); without it only
 * untargeted cards can be played.
 */
export interface TargetingResolver<W> {
  /** Legal choices; `null` means the card needs no target. */
  choices(state: GameState<W>, side: SideId, targeting: Targeting): (string | null)[];
  bind(state: GameState<W>, side: SideId, targeting: Targeting, target: string | null): Record<string, unknown>;
}

export interface ZonesOptions<W> {
  targeting?: TargetingResolver<W>;
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
const side = z.string().min(1).optional();
const card = z.string().min(1);
const count = z.number().int().min(1);

export function zonesModule<W extends CardsWorld>(defs: Record<string, CardDef>, options: ZonesOptions<W> = {}): RulesModule<W> {
  const sideOf = (ctx: EffectContext<W>, p: Record<string, unknown>): SideId => {
    const s = (p.side as SideId | undefined) ?? ctx.item.controller;
    if (s === null || s === undefined) throw new ContentError(`op on a '${ctx.item.kind}' item needs a side`);
    return s;
  };
  const cardsOf = (state: GameState<W>) => state.world.cards;
  const move = (cardId: string, toZone: string, extra: Record<string, unknown> = {}): Step => ({
    kind: 'moveCard',
    card: cardId,
    toZone,
    ...extra,
  });
  const cardParam = (ctx: EffectContext<W>, p: Record<string, unknown>) => str(p.card ?? ctx.item.vars.target);

  const shuffle = (ctx: EffectContext<W>, s: SideId, name: string) => {
    ctx.step({ kind: 'orderZone', side: s, zone: name, order: ctx.rng.shuffle(zone(cardsOf(ctx.state), s, name)) });
  };

  /** Moves the discard pile into the draw pile and shuffles it (empty discard: no-op). */
  const reshuffle = (ctx: EffectContext<W>, s: SideId) => {
    const discard = zone(cardsOf(ctx.state), s, 'discard').slice();
    if (discard.length === 0) return;
    ctx.step(discard.map((c) => move(c, 'draw', { position: 'bottom', reason: 'reshuffle' })));
    shuffle(ctx, s, 'draw');
  };

  const choices = (state: GameState<W>, s: SideId, def: CardDef): (string | null)[] => {
    const targeting = def.targeting ?? { kind: 'none' };
    if (options.targeting) return options.targeting.choices(state, s, targeting);
    return targeting.kind === 'none' ? [null] : [];
  };

  const playCard: ActionDef<W> = {
    list(state, s) {
      const cards = cardsOf(state);
      return zone(cards, s, 'hand').flatMap((id) => {
        const def = effectiveDef(defs, cards.instances[id] as CardInstance);
        if (!canAfford(cards, s, def.cost)) return [];
        return choices(state, s, def).map((target) =>
          target === null ? { type: 'playCard', side: s, card: id } : { type: 'playCard', side: s, card: id, target },
        );
      });
    },
    perform(ctx, action) {
      const cards = cardsOf(ctx.state);
      const instance = cards.instances[str(action.card)] as CardInstance;
      const def = effectiveDef(defs, instance);
      const targeting = def.targeting ?? { kind: 'none' };
      // Bind targets before paying costs, so variables describe the board as the card was played.
      const bound = options.targeting?.bind(ctx.state, action.side, targeting, (action.target as string | undefined) ?? null) ?? {};
      const costs = Object.entries(def.cost ?? {}).filter(([, amount]) => amount > 0);
      if (costs.length > 0) {
        ctx.step(costs.map(([resource, amount]) => ({ kind: 'resource', side: action.side, resource, delta: -amount, reason: 'cost' })));
      }
      ctx.step(move(instance.id, 'resolving', { reason: 'play' }));
      ctx.announce({
        kind: 'card',
        controller: action.side,
        source: instance.id,
        effects: def.effects,
        vars: { ...bound, card: instance.id, handAtPlay: zone(cardsOf(ctx.state), action.side, 'hand').length },
      });
    },
  };

  return {
    name: 'zones',
    actions: { playCard },

    steps: {
      moveCard(state, s) {
        const cards = cardsOf(state);
        const cardId = str(s.card);
        const from = locateCard(cards, cardId);
        if (!from) throw new ContentError(`card '${cardId}' is not in any zone`);
        const toSide = (s.toSide as SideId | undefined) ?? from.side;
        const toZone = str(s.toZone);
        const target = zone(cards, toSide, toZone);
        zone(cards, from.side, from.zone).splice(from.index, 1);
        if (s.position === 'bottom') target.push(cardId);
        else target.unshift(cardId);
        const type = MOVE_EVENTS[str(s.reason)] ?? 'CardMoved';
        const instance = cards.instances[cardId] as CardInstance;
        return [
          {
            type,
            card: cardId,
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
      upgradeCard(state, s) {
        const instance = cardsOf(state).instances[str(s.card)];
        if (!instance || instance.upgraded) return [];
        instance.upgraded = true;
        return [{ type: 'CardUpgraded', card: instance.id, def: instance.def }];
      },
    },

    ops: {
      draw: defineOp(
        {
          displayName: 'Draw',
          description: 'Draw cards from the top of the draw pile, reshuffling the discard pile if it runs out.',
          params: z.object({ n: count, side }),
          text: 'Draw {n:card|cards}.',
          widgets: { n: 'number', side: 'side' },
          category: 'cards',
        },
        (ctx, p) => {
          const s = sideOf(ctx, p);
          for (let i = 0; i < (p.n as number); i++) {
            if (zone(cardsOf(ctx.state), s, 'draw').length === 0) reshuffle(ctx, s);
            const top = zone(cardsOf(ctx.state), s, 'draw')[0];
            if (top === undefined) return;
            ctx.step(move(top, 'hand', { reason: 'draw' }));
          }
        },
      ),
      shuffle: defineOp(
        {
          displayName: 'Shuffle',
          description: 'Shuffle a zone.',
          params: z.object({ zone: z.string().min(1), side }),
          text: 'Shuffle your {zone}.',
          category: 'cards',
        },
        (ctx, p) => shuffle(ctx, sideOf(ctx, p), str(p.zone)),
      ),
      discard: defineOp(
        {
          displayName: 'Discard',
          description: 'Discard a card (the target card if none is given).',
          params: z.object({ card: card.optional() }),
          text: 'Discard a card.',
          widgets: { card: 'card' },
          category: 'cards',
        },
        (ctx, p) => ctx.step(move(cardParam(ctx, p), 'discard', { reason: 'discard' })),
      ),
      discardHand: defineOp(
        {
          displayName: 'Discard hand',
          description: 'Discard every card in hand. Sets `discarded.count`.',
          params: z.object({ side }),
          text: 'Discard your hand.',
          category: 'cards',
        },
        (ctx, p) => {
          const hand = zone(cardsOf(ctx.state), sideOf(ctx, p), 'hand').slice();
          if (hand.length > 0) ctx.step(hand.map((c) => move(c, 'discard', { reason: 'discard' })));
          ctx.setVar('discarded', { count: hand.length });
        },
      ),
      exhaust: defineOp(
        {
          displayName: 'Exhaust',
          description: 'Remove a card to the exhaust zone (the target card if none is given).',
          params: z.object({ card: card.optional() }),
          text: 'Exhaust a card.',
          widgets: { card: 'card' },
          category: 'cards',
        },
        (ctx, p) => ctx.step(move(cardParam(ctx, p), 'exhaust', { reason: 'exhaust' })),
      ),
      moveCard: defineOp(
        {
          displayName: 'Move card',
          description: 'Put a card on the top or bottom of a zone.',
          params: z.object({ card: card.optional(), zone: z.string().min(1), position: z.enum(['top', 'bottom']).optional(), side }),
          text: 'Put a card into your {zone}.',
          widgets: { card: 'card', position: 'enum' },
          category: 'cards',
        },
        (ctx, p) =>
          ctx.step(move(cardParam(ctx, p), str(p.zone), { position: p.position ?? 'top', ...(p.side !== undefined && { toSide: p.side }) })),
      ),
      search: defineOp(
        {
          displayName: 'Search',
          description: 'Move the first matching cards from one zone to another. Sets `found.count`.',
          params: z.object({ def: z.string().min(1), from: z.string().min(1).optional(), to: z.string().min(1).optional(), n: count.optional(), side }),
          text: 'Search for {def}.',
          widgets: { def: 'card' },
          category: 'cards',
        },
        (ctx, p) => {
          const s = sideOf(ctx, p);
          const cards = cardsOf(ctx.state);
          const found = zone(cards, s, str(p.from ?? 'draw'))
            .filter((id) => cards.instances[id]?.def === p.def)
            .slice(0, (p.n as number | undefined) ?? 1);
          if (found.length > 0) ctx.step(found.map((c) => move(c, str(p.to ?? 'hand'))));
          ctx.setVar('found', { count: found.length });
        },
      ),
      upgradeCard: defineOp(
        {
          displayName: 'Upgrade card',
          description: 'Upgrade a card for the rest of the game (the played card if none is given).',
          params: z.object({ card: card.optional() }),
          text: 'Upgrade a card.',
          widgets: { card: 'card' },
          category: 'cards',
        },
        (ctx, p) => ctx.step({ kind: 'upgradeCard', card: p.card ?? ctx.item.vars.card }),
      ),
      gainResource: defineOp(
        {
          displayName: 'Gain resource',
          description: 'Gain an amount of a resource such as energy.',
          params: z.object({ resource: z.string().min(1), amount: z.number().int(), side }),
          text: 'Gain {amount} {resource}.',
          category: 'cards',
        },
        (ctx, p) => ctx.step({ kind: 'resource', side: sideOf(ctx, p), resource: p.resource, delta: p.amount, reason: 'effect' }),
      ),
      countCards: defineOp(
        {
          displayName: 'Count cards',
          description: 'Store the number of cards in a zone in a variable.',
          params: z.object({ zone: z.string().min(1), as: z.string().min(1), side }),
          text: '',
          category: 'variables',
        },
        (ctx, p) => ctx.setVar(str(p.as), zone(cardsOf(ctx.state), sideOf(ctx, p), str(p.zone)).length),
      ),
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
