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
import type { PatternShape } from '../board/topology.js';
import { canSee, opaqueId, type Visibility } from '../kernel/visibility.js';
import type { ActionDef, Effect, EffectContext, EventInput, GameState, Prompt, SideId, Step, WindowTiming } from '../kernel/types.js';
import { defineOp, type RulesModule } from '../rules/compose.js';

/** Zones every side has. Packages may add more by name. */
export const ZONES = ['draw', 'hand', 'discard', 'exhaust', 'resolving', 'inPlay'] as const;

export interface CardInstance {
  id: string;
  /** Content id of the card definition. */
  def: string;
  owner: SideId;
  upgraded?: boolean;
  /** Overrides its zone's visibility, e.g. a revealed card in hand (#53). */
  visibility?: Visibility;
  /** Times it has been shuffled; each shuffle issues a fresh opaque id (#53). */
  shuffles?: number;
}

/** Who sees cards in each zone (#53): the draw pile's order is hidden even from its owner. */
export const ZONE_VISIBILITY: Record<string, Visibility> = {
  draw: 'hidden',
  hand: 'owner',
  discard: 'public',
  exhaust: 'public',
  resolving: 'public',
  inPlay: 'public',
};

const CARD_EVENTS = new Set([
  'CardDrawn',
  'CardDiscarded',
  'CardExhausted',
  'CardPlayed',
  'CardMoved',
  'CardUpgraded',
  'CardRevealed',
  'CardConcealed',
]);

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

export interface ReactionCondition {
  /** Item kinds it responds to, e.g. ['intent'] or ['card']. Any kind if omitted. */
  kind?: string[];
  /** Whose item: an opponent's (default), your own, or anyone's. */
  from?: 'opponent' | 'self' | 'any';
  /** Only items whose target is one of your units. */
  targetsYou?: boolean;
  /** Only items that are themselves reactions. */
  reaction?: boolean;
  /** Windows it may be played in. Default: itemAnnounced and itemTop. */
  windows?: WindowTiming[];
}

/** Whether a reaction may be played against the prompt's item (§5.2). */
export function reactionAllowed(state: GameState<unknown>, side: SideId, prompt: Prompt, condition: ReactionCondition = {}): boolean {
  const windows = condition.windows ?? ['itemAnnounced', 'itemTop'];
  if (!windows.includes(prompt.window)) return false;
  const item = state.stack.find((i) => i.id === prompt.item);
  if (prompt.item !== null && !item) return false;
  if (!item) return condition.kind === undefined && condition.targetsYou !== true && condition.reaction !== true;
  if (condition.kind && !condition.kind.includes(item.kind)) return false;
  const from = condition.from ?? 'opponent';
  if (from === 'opponent' && item.controller === side) return false;
  if (from === 'self' && item.controller !== side) return false;
  if (condition.reaction === true && item.vars.reaction !== true) return false;
  if (condition.targetsYou) {
    const units = (state.world as { board?: { units: Record<string, { side: SideId }> } }).board?.units;
    if (typeof item.vars.target !== 'string' || units?.[item.vars.target]?.side !== side) return false;
  }
  return true;
}

/** Makes a card a permanent when it resolves (#55, requirement #50). */
export interface CardPermanent {
  kind: 'unit' | 'structure' | 'trap' | 'aura' | 'attachment';
  /** Unit definition for kinds that occupy a tile (unit, structure, trap). */
  unit?: string;
  /** Whether it blocks movement; structures do by default, traps never do. */
  blocking?: boolean;
  /** Leaves play at the end of its controller's Nth phase, counting the one it entered in. */
  duration?: number;
  /** Where its card goes when it leaves play. Default discard. */
  leaveTo?: string;
  abilities?: PermanentAbility[];
  statics?: PermanentStatic[];
}

/** Which units a permanent's static or trigger cares about, relative to its controller. */
export type Affects = 'allies' | 'enemies' | 'all' | 'host';

export type PermanentAbility =
  | {
      kind: 'triggered';
      /** Event type, e.g. 'PhaseEnded' or 'UnitEnteredTile'. */
      on: string;
      /** `when` interrupts inline (traps); `after` (default) goes on the stack. */
      timing?: 'when' | 'after';
      /** Whose event, relative to the permanent's controller: its own (default for phase events), allies', enemies' or anyone's. */
      scope?: 'self' | 'ally' | 'enemy' | 'any';
      /** Only events on the permanent's own tile (e.g. a unit stepping onto a trap). */
      onTile?: boolean;
      phase?: string;
      /** Stop the effect that caused the event, e.g. the rest of a push. */
      halt?: boolean;
      /** Leaves play after it fires once. */
      consume?: boolean;
      effects: Effect[];
    }
  | {
      kind: 'activated';
      name: string;
      cost?: Record<string, number>;
      timing?: 'main' | 'reaction' | 'any';
      reaction?: ReactionCondition;
      /** Measured from the permanent's unit (or an attachment's host). */
      targeting?: Targeting;
      /** At most once per turn (default true). */
      oncePerTurn?: boolean;
      effects: Effect[];
    };

/** A continuous effect, recalculated after every step (§9.3). */
export type PermanentStatic =
  | { kind: 'maxHp'; amount: number; affects?: Affects; area?: PatternShape }
  | { kind: 'damage'; on: 'damageTaken' | 'damageDealt'; add?: number; multiply?: number; affects?: Affects; area?: PatternShape };

export interface CardDef {
  cost?: Record<string, number>;
  targeting?: Targeting;
  permanent?: CardPermanent;
  /** Played face-down: hidden from other sides when played (#56). Traps are face-down by default. */
  faceDown?: boolean;
  /** When it can be played (#57): main phase (default), only in response windows, or both. */
  timing?: 'main' | 'reaction' | 'any';
  /** What a reaction may respond to; checked against the item it would respond to (§5.2). */
  reaction?: ReactionCondition;
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
  /** Extra rule for whether a card can be played now, e.g. a permanents limit. */
  playable?(state: GameState<W>, side: SideId, def: CardDef): boolean;
  /** Visibility of zones by name; package zones default to public. */
  zoneVisibility?: Record<string, Visibility>;
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

  const playable = (state: GameState<W>, s: SideId, accept: (def: CardDef) => boolean) => {
    const cards = cardsOf(state);
    return zone(cards, s, 'hand').flatMap((id) => {
      const def = effectiveDef(defs, cards.instances[id] as CardInstance);
      if (!accept(def) || !canAfford(cards, s, def.cost)) return [];
      if (options.playable && !options.playable(state, s, def)) return [];
      return choices(state, s, def).map((target) =>
        target === null ? { type: 'playCard', side: s, card: id } : { type: 'playCard', side: s, card: id, target },
      );
    });
  };

  const playCard: ActionDef<W> = {
    list: (state, s) => playable(state, s, (def) => (def.timing ?? 'main') !== 'reaction'),
    respond: (state, s, prompt) =>
      playable(state, s, (def) => (def.timing ?? 'main') !== 'main' && reactionAllowed(state, s, prompt, def.reaction)),
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
      const faceDown = def.faceDown ?? def.permanent?.kind === 'trap';
      if (faceDown) ctx.step({ kind: 'setCardVisibility', card: instance.id, visibility: 'owner' });
      ctx.step(move(instance.id, 'resolving', { reason: 'play' }));
      ctx.announce({
        kind: 'card',
        controller: action.side,
        source: instance.id,
        ...(faceDown && { secret: true }),
        // A permanent enters play first unless the card says where (§9.1).
        effects: def.permanent && !def.effects.some((e) => e.op === 'enterPlay') ? [{ op: 'enterPlay' }, ...def.effects] : def.effects,
        vars: {
          ...bound,
          card: instance.id,
          handAtPlay: zone(cardsOf(ctx.state), action.side, 'hand').length,
          // A reaction remembers what it answered, for counter/redirect/modify (§5.3).
          ...(ctx.answering && { reaction: true, respondingTo: ctx.answering.item }),
        },
      });
    },
  };

  const zoneVisibility = { ...ZONE_VISIBILITY, ...options.zoneVisibility };
  const visibleTo = (instance: CardInstance | undefined, side: SideId, zoneName: string, viewer: SideId | null) =>
    canSee(instance?.visibility ?? zoneVisibility[zoneName] ?? 'public', viewer, side);

  return {
    name: 'zones',
    actions: { playCard },

    view(world, viewer, state) {
      const cards = world.cards;
      for (const [side, zones] of Object.entries(cards.zones)) {
        for (const [zoneName, ids] of Object.entries(zones)) {
          zones[zoneName] = ids.map((id) => {
            const instance = state.world.cards.instances[id];
            if (visibleTo(instance, side, zoneName, viewer)) return id;
            delete cards.instances[id];
            return opaqueId(state, 'card', id, instance?.shuffles);
          });
        }
      }
      for (const instance of Object.values(cards.instances)) delete instance.shuffles;
    },

    redact(event, viewer, state) {
      if (!CARD_EVENTS.has(event.type)) return event;
      const instance = state.world.cards.instances[str(event.card)];
      const ends = [event.from, event.to].filter(Boolean) as { side: SideId; zone: string }[];
      if (ends.length === 0) {
        const where = locateCard(state.world.cards, str(event.card));
        if (where) ends.push(where);
      }
      if (ends.some((e) => visibleTo(instance, e.side, e.zone, viewer))) return event;
      const { def: _def, ...rest } = event;
      return { ...rest, card: event.hidden };
    },

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
            hidden: opaqueId(state, 'card', cardId, instance.shuffles),
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
        // Fresh opaque ids, so hidden cards cannot be tracked through the shuffle,
        // and whatever was revealed about them is lost.
        for (const id of ids) {
          const instance = cardsOf(state).instances[id] as CardInstance;
          instance.shuffles = (instance.shuffles ?? 0) + 1;
          delete instance.visibility;
        }
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
      setCardVisibility(state, s) {
        const instance = cardsOf(state).instances[str(s.card)];
        if (!instance) return [];
        const visibility = s.visibility as Visibility | null;
        if (visibility === null) delete instance.visibility;
        else instance.visibility = visibility;
        const revealed = visibility === null || visibility === 'public' || typeof visibility === 'object';
        return [
          {
            type: revealed ? 'CardRevealed' : 'CardConcealed',
            card: instance.id,
            def: instance.def,
            hidden: opaqueId(state, 'card', instance.id, instance.shuffles),
            visibility: visibility ?? null,
          },
        ];
      },
      upgradeCard(state, s) {
        const instance = cardsOf(state).instances[str(s.card)];
        if (!instance || instance.upgraded) return [];
        instance.upgraded = true;
        return [{ type: 'CardUpgraded', card: instance.id, def: instance.def, hidden: opaqueId(state, 'card', instance.id, instance.shuffles) }];
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
          widgets: { def: 'cardDef' },
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
      reveal: defineOp(
        {
          displayName: 'Reveal',
          description: 'Show a card (the target) to everyone until it is shuffled away.',
          params: z.object({ card: card.optional() }),
          text: 'Reveal a card.',
          widgets: { card: 'card' },
          category: 'visibility',
        },
        (ctx, p) => ctx.step({ kind: 'setCardVisibility', card: cardParam(ctx, p), visibility: 'public' }),
      ),
      conceal: defineOp(
        {
          displayName: 'Conceal',
          description: 'Return a card (the target) to its zone’s normal visibility.',
          params: z.object({ card: card.optional() }),
          text: 'Conceal a card.',
          widgets: { card: 'card' },
          category: 'visibility',
        },
        (ctx, p) => ctx.step({ kind: 'setCardVisibility', card: cardParam(ctx, p), visibility: null }),
      ),
      peek: defineOp(
        {
          displayName: 'Peek',
          description: 'Look at the top cards of a zone (default your draw pile) without moving them. Sets `peeked.cards`.',
          params: z.object({ n: count, zone: z.string().min(1).optional(), side }),
          text: 'Look at the top {n:card|cards}.',
          widgets: { n: 'number' },
          category: 'visibility',
        },
        (ctx, p) => {
          const peeker = ctx.item.controller;
          if (peeker === null) throw new ContentError('peek needs a controlling side');
          const s = sideOf(ctx, p);
          const zoneName = str(p.zone ?? 'draw');
          const top = zone(cardsOf(ctx.state), s, zoneName).slice(0, p.n as number);
          const sides = ctx.state.sides.map((x) => x.id);
          const steps: Step[] = [];
          for (const id of top) {
            const instance = cardsOf(ctx.state).instances[id];
            if (visibleTo(instance, s, zoneName, peeker)) continue;
            // Keep everyone who could already see it, and add the peeker.
            const already = sides.filter((viewer) => visibleTo(instance, s, zoneName, viewer));
            steps.push({ kind: 'setCardVisibility', card: id, visibility: { revealedTo: [...new Set([...already, peeker])] } });
          }
          if (steps.length > 0) ctx.step(steps);
          ctx.setVar('peeked', { cards: top });
        },
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
      // A face-down card that resolved (rather than staying in play) is revealed (§7).
      if (item.secret) ctx.step({ kind: 'setCardVisibility', card: item.source, visibility: null });
      // Not a discard: "whenever you discard" triggers must not fire for a played card.
      ctx.step(move(item.source, def.exhausts ? 'exhaust' : 'discard', { reason: def.exhausts ? 'exhaust' : 'resolved' }));
    },
  };
}
