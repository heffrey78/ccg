/**
 * Permanents (#55, requirement #50, decision #52, resolution-order §9): cards
 * that enter play and stay. A permanent keeps a reference to its card
 * instance, which waits in the `inPlay` zone with its upgrades; when the
 * permanent leaves play the card goes to a zone of its *owner*, whoever
 * controls it by then.
 *
 * Units, structures and traps occupy a tile as board units (so they take
 * damage, block and die through the board rules; traps are passable and
 * hidden from the other side). Auras sit on a tile and attachments on a host
 * unit, without a board unit of their own. Abilities, statics and trap
 * triggers are #58.
 *
 * World slice: `permanents`.
 */
import { z } from 'zod';
import type { CardDef, CardsWorld, CardPermanent } from '../cards/zones.js';
import { ContentError } from '../kernel/params.js';
import type { EffectContext, GameEvent, GameState, SideId } from '../kernel/types.js';
import { defineOp, type RulesModule } from '../rules/compose.js';
import type { Pos, Topology } from './topology.js';
import { unitAt, unitsAt, type BoardWorld, type UnitDef } from './units.js';

export interface PermanentState {
  id: string;
  kind: CardPermanent['kind'];
  /** The card instance it came from. */
  card: string;
  owner: SideId;
  controller: SideId;
  /** Board unit (unit, structure, trap) or host unit (attachment). */
  unit?: string;
  /** Position of an aura. */
  pos?: Pos;
  /** Phases of its controller left before it expires. */
  turnsLeft?: number;
  leaveTo: string;
  createdAt: number;
}

export interface PermanentsWorld {
  permanents: Record<string, PermanentState>;
}

export interface PermanentsConfig {
  topology: Topology;
  cards: Record<string, CardDef>;
  units: Record<string, UnitDef>;
  /** Most permanents a side may control at once. */
  maxPerSide?: number;
  /** Units entering play cannot use the basic move action that turn. Default true. */
  summoningSickness?: boolean;
}

type World = BoardWorld & CardsWorld & PermanentsWorld;
const str = (v: unknown) => v as string;
const turnKey = (state: GameState<unknown>) => `${state.turn.round}:${state.turn.activeSide}`;

export function controlledBy(state: GameState<PermanentsWorld>, side: SideId): PermanentState[] {
  return Object.values(state.world.permanents).filter((p) => p.controller === side);
}

/** A `playable` rule for the zones module that enforces `maxPerSide` (#55 summoning rules). */
export function permanentsPlayable<W extends World>(config: PermanentsConfig) {
  return (state: GameState<W>, side: SideId, def: CardDef) =>
    !def.permanent || config.maxPerSide === undefined || controlledBy(state, side).length < config.maxPerSide;
}

export function permanentsModule<W extends World>(config: PermanentsConfig): RulesModule<W> {
  const tileKinds = new Set(['unit', 'structure', 'trap']);

  const byUnit = (state: GameState<W>, unit: string) =>
    Object.values(state.world.permanents).find((p) => p.unit === unit && tileKinds.has(p.kind));

  /** Takes a permanent out of play: its card to the owner's zone, its board unit off the board. */
  const leave = (ctx: EffectContext<W>, permanent: PermanentState, reason: string, zone?: string) => {
    ctx.step({ kind: 'leavePermanent', permanent: permanent.id, reason });
    ctx.step({ kind: 'moveCard', card: permanent.card, toSide: permanent.owner, toZone: zone ?? permanent.leaveTo, reason: 'leftPlay' });
    if (tileKinds.has(permanent.kind) && permanent.unit && ctx.state.world.board.units[permanent.unit]) {
      ctx.step({ kind: 'remove', unit: permanent.unit, reason });
    }
  };

  const findTarget = (ctx: EffectContext<W>, p: Record<string, unknown>) => {
    const ref = str(p.permanent ?? p.unit ?? ctx.item.vars.target);
    return ctx.state.world.permanents[ref] ?? byUnit(ctx.state, ref);
  };

  return {
    name: 'permanents',

    // Runs after the board's view: permanents on units the viewer cannot see (e.g. traps) go too.
    view(world, viewer) {
      for (const p of Object.values(world.permanents)) {
        if (p.controller !== viewer && p.unit !== undefined && !world.board.units[p.unit]) delete world.permanents[p.id];
      }
    },

    steps: {
      enterPermanent(state, s) {
        const permanent = s.permanent as PermanentState;
        state.world.permanents[permanent.id] = permanent;
        if (tileKinds.has(permanent.kind)) {
          const unitDef = config.units[str(s.unitDef)];
          if (!unitDef) throw new ContentError(`unknown unit definition '${str(s.unitDef)}'`);
          state.world.board.units[permanent.id] = {
            id: permanent.id,
            def: str(s.unitDef),
            side: permanent.controller,
            pos: str(s.pos),
            facing: str(s.facing),
            hp: unitDef.hp,
            maxHp: unitDef.hp,
            block: 0,
            statuses: { ...unitDef.statuses },
            createdAt: permanent.createdAt,
            ...(s.passable === true && { passable: true }),
            ...(permanent.kind === 'trap' && { visibility: 'owner' as const }),
            ...(typeof s.sickOn === 'string' && { movedOn: s.sickOn }),
          };
        }
        const instance = state.world.cards.instances[permanent.card];
        // A trap's card is face-down too.
        if (permanent.kind === 'trap' && instance) instance.visibility = 'owner';
        return [
          {
            type: 'PermanentEntered',
            permanent: permanent.id,
            kind: permanent.kind,
            card: permanent.card,
            owner: permanent.owner,
            controller: permanent.controller,
            ...(tileKinds.has(permanent.kind) && { unit: permanent.id }),
            ...(permanent.kind === 'attachment' && { host: permanent.unit }),
            pos: (s.pos as string | undefined) ?? null,
          },
        ];
      },
      leavePermanent(state, s) {
        const permanent = state.world.permanents[str(s.permanent)];
        if (!permanent) return [];
        delete state.world.permanents[permanent.id];
        const instance = state.world.cards.instances[permanent.card];
        if (instance) delete instance.visibility;
        return [
          { type: 'PermanentLeftPlay', permanent: permanent.id, kind: permanent.kind, card: permanent.card, owner: permanent.owner, reason: s.reason ?? null },
        ];
      },
      setController(state, s) {
        const permanent = state.world.permanents[str(s.permanent)];
        if (!permanent || permanent.controller === s.side) return [];
        permanent.controller = str(s.side);
        const unit = tileKinds.has(permanent.kind) && permanent.unit ? state.world.board.units[permanent.unit] : undefined;
        if (unit) unit.side = permanent.controller;
        return [{ type: 'ControlChanged', permanent: permanent.id, controller: permanent.controller, owner: permanent.owner }];
      },
      tickPermanent(state, s) {
        const permanent = state.world.permanents[str(s.permanent)];
        if (permanent?.turnsLeft !== undefined) permanent.turnsLeft -= 1;
        return [];
      },
    },

    ops: {
      enterPlay: defineOp(
        {
          displayName: 'Enter play',
          description: 'Put the played card into play as its permanent, on a tile or attached to a unit (the target).',
          params: z.object({ pos: z.string().min(1).optional(), host: z.string().min(1).optional() }),
          text: 'Put it into play.',
          widgets: { pos: 'tile', host: 'unit' },
          category: 'permanents',
        },
        (ctx, p) => {
          const card = str(ctx.item.vars.card);
          const instance = ctx.state.world.cards.instances[card];
          const spec = instance && config.cards[instance.def]?.permanent;
          const controller = ctx.item.controller;
          if (!instance || !spec || controller === null) throw new ContentError('enterPlay needs a played permanent card');
          if (config.maxPerSide !== undefined && controlledBy(ctx.state, controller).length >= config.maxPerSide) return;

          const board = ctx.state.world.board;
          const self = board.units[str(ctx.item.vars.self)];
          const id = ctx.newId('perm');
          const permanent: PermanentState = {
            id,
            kind: spec.kind,
            card,
            owner: instance.owner,
            controller,
            leaveTo: spec.leaveTo ?? 'discard',
            createdAt: ctx.state.seq,
            ...(spec.duration !== undefined && { turnsLeft: spec.duration }),
          };
          const step: Record<string, unknown> = { kind: 'enterPermanent', permanent };

          if (tileKinds.has(spec.kind)) {
            const pos = str(p.pos ?? ctx.item.vars.target);
            const passable = spec.kind === 'trap' || spec.blocking === false;
            // A tile can hold one occupying unit and one passable permanent.
            if (!config.topology.contains(pos) || (!passable && unitAt(board, pos)) || unitsAt(board, pos).some((u) => u.passable)) return;
            if (!spec.unit) throw new ContentError(`a ${spec.kind} permanent needs a unit definition`);
            permanent.unit = id;
            Object.assign(step, {
              pos,
              unitDef: spec.unit,
              facing: self?.facing ?? config.topology.directions()[0],
              passable,
              ...((config.summoningSickness ?? true) && { sickOn: turnKey(ctx.state) }),
            });
          } else if (spec.kind === 'attachment') {
            const host = str(p.host ?? ctx.item.vars.target);
            if (!board.units[host]) return;
            permanent.unit = host;
          } else {
            const pos = str(p.pos ?? ctx.item.vars.target ?? self?.pos);
            if (!config.topology.contains(pos)) return;
            permanent.pos = pos;
            step.pos = pos;
          }
          ctx.step(step as never);
          ctx.step({ kind: 'moveCard', card, toZone: 'inPlay', reason: 'enterPlay' });
          ctx.setVar('entered', { permanent: id });
        },
      ),
      returnPermanent: defineOp(
        {
          displayName: 'Return permanent',
          description: "Take a permanent (the target) out of play and put its card into its owner's zone, e.g. hand.",
          params: z.object({ permanent: z.string().min(1).optional(), zone: z.string().min(1) }),
          text: "Return a permanent to its owner's {zone}.",
          widgets: { permanent: 'unit' },
          category: 'permanents',
        },
        (ctx, p) => {
          const permanent = findTarget(ctx, p);
          if (permanent) leave(ctx, permanent, 'returned', str(p.zone));
        },
      ),
      gainControl: defineOp(
        {
          displayName: 'Gain control',
          description: 'Take control of a permanent (the target). Its owner does not change.',
          params: z.object({ permanent: z.string().min(1).optional(), side: z.string().min(1).optional() }),
          text: 'Gain control of a permanent.',
          widgets: { permanent: 'unit', side: 'side' },
          category: 'permanents',
        },
        (ctx, p) => {
          const permanent = findTarget(ctx, p);
          const side = p.side ?? ctx.item.controller;
          if (permanent && side) ctx.step({ kind: 'setController', permanent: permanent.id, side });
        },
      ),
      // Internal: a permanent's board unit left play (died, removed) — its card follows.
      leavePermanent(ctx, p) {
        const permanent = ctx.state.world.permanents[str(p.permanent)];
        if (permanent) leave(ctx, permanent, str(p.reason ?? 'left'));
      },
      // Internal: count down timed permanents of the side whose phase ended.
      tickPermanents(ctx) {
        const side = (ctx.item.vars.event as GameEvent).activeSide;
        for (const permanent of Object.values(ctx.state.world.permanents)) {
          if (permanent.controller !== side || permanent.turnsLeft === undefined) continue;
          ctx.step({ kind: 'tickPermanent', permanent: permanent.id });
          const current = ctx.state.world.permanents[permanent.id];
          if (current?.turnsLeft !== undefined && current.turnsLeft <= 0) leave(ctx, current, 'expired');
        }
      },
    },

    listeners(state) {
      const out: ReturnType<NonNullable<RulesModule<W>['listeners']>> = [];
      for (const permanent of Object.values(state.world.permanents)) {
        if (!tileKinds.has(permanent.kind)) continue;
        out.push({
          kind: 'interrupt',
          id: `permanent:${permanent.id}:leaves`,
          source: permanent.id,
          controller: permanent.controller,
          layer: 'rules',
          timestamp: permanent.createdAt,
          matches: (e) => e.type === 'UnitLeftPlay' && e.unit === permanent.unit,
          effects: [{ op: 'leavePermanent', permanent: permanent.id, reason: { $: 'event.reason' } }],
        });
      }
      if (Object.values(state.world.permanents).some((p) => p.turnsLeft !== undefined)) {
        out.push({
          kind: 'trigger',
          id: 'permanents:tick',
          source: null,
          controller: null,
          layer: 'rules',
          timestamp: 0,
          matches: (e) => e.type === 'PhaseEnded' && e.activeSide !== null,
          effects: [{ op: 'tickPermanents' }],
        });
      }
      return out;
    },

    stateChecks: [
      // An attachment whose host has left play goes with it (§9.4).
      (ctx) => {
        const orphan = Object.values(ctx.state.world.permanents).find(
          (p) => p.kind === 'attachment' && p.unit !== undefined && !ctx.state.world.board.units[p.unit],
        );
        if (!orphan) return false;
        ctx.step({ kind: 'leavePermanent', permanent: orphan.id, reason: 'hostLeft' });
        ctx.step({ kind: 'moveCard', card: orphan.card, toSide: orphan.owner, toZone: orphan.leaveTo, reason: 'leftPlay' });
        return true;
      },
    ],
  };
}
