/**
 * Statuses and keywords on units (#24, requirement #2): stack counts,
 * lifecycle, hooks that react to events, and damage modifiers.
 *
 * Stacks live on the unit (`UnitState.statuses`); definitions are static.
 * A hook's effects see `holder` (and `self`) as the unit with the status, and
 * `stacks` as its stack count when the hook fired.
 */
import { z } from 'zod';
import { ContentError } from '../kernel/params.js';
import type { Effect, GameEvent, Listener, Step } from '../kernel/types.js';
import { defineOp, type RulesModule } from '../rules/compose.js';
import type { BoardWorld, UnitState } from './units.js';

export interface StatusHook {
  /** Event type to react to, e.g. 'DamageDealt' or 'PhaseStarted'. */
  on: string;
  /** `after` (default) goes on the stack; `when` interrupts inline (resolution-order §6). */
  timing?: 'when' | 'after';
  /**
   * Whose event: the holder's own (default), its allies', its enemies', or
   * anyone's. Events about a unit compare that unit; phase events compare the
   * active side.
   */
  scope?: 'self' | 'ally' | 'enemy' | 'any';
  /** Only for events of this phase (phase events). */
  phase?: string;
  effects: Effect[];
}

export interface DamageModifier {
  /** Change damage the holder takes or deals. */
  on: 'damageTaken' | 'damageDealt';
  add?: number;
  /** Added once per stack. */
  perStack?: number;
  /** Applied after every addition; the result rounds down. */
  multiply?: number;
}

export interface StatusDef {
  /**
   * `intensity`: stacks add up and stay. `duration`: stacks add up and one is
   * lost each time the holder's side ends a phase. `none`: present or not.
   */
  stacking: 'intensity' | 'duration' | 'none';
  hooks?: StatusHook[];
  modifiers?: DamageModifier[];
}

const str = (v: unknown) => v as string;

export function statusesModule<W extends BoardWorld>(defs: Record<string, StatusDef>): RulesModule<W> {
  const def = (id: string) => {
    const d = defs[id];
    if (!d) throw new ContentError(`unknown status '${id}'`);
    return d;
  };

  const related = (event: GameEvent, holder: UnitState, scope: StatusHook['scope'] = 'self'): boolean => {
    if (scope === 'any') return true;
    if (typeof event.unit === 'string') {
      if (scope === 'self') return event.unit === holder.id;
      return scope === 'ally' ? event.side === holder.side && event.unit !== holder.id : event.side !== holder.side;
    }
    if ('activeSide' in event) {
      return scope === 'enemy' ? event.activeSide !== null && event.activeSide !== holder.side : event.activeSide === holder.side;
    }
    return false;
  };

  /** Combined damage change from every relevant status, so status order never matters. */
  const damageChange = (taker: UnitState | undefined, dealer: UnitState | undefined) => {
    let add = 0;
    let multiply = 1;
    const collect = (unit: UnitState | undefined, on: DamageModifier['on']) => {
      for (const [status, stacks] of Object.entries(unit?.statuses ?? {})) {
        for (const m of defs[status]?.modifiers ?? []) {
          if (m.on !== on || stacks <= 0) continue;
          add += (m.add ?? 0) + (m.perStack ?? 0) * stacks;
          multiply *= m.multiply ?? 1;
        }
      }
    };
    collect(taker, 'damageTaken');
    if (dealer && dealer !== taker) collect(dealer, 'damageDealt');
    return { add, multiply, any: add !== 0 || multiply !== 1 };
  };

  return {
    name: 'statuses',

    steps: {
      status(state, s) {
        const u = state.world.board.units[str(s.unit)];
        if (!u) return [];
        const id = str(s.status);
        const before = u.statuses[id] ?? 0;
        let after = Math.max(0, before + (s.delta as number));
        if (def(id).stacking === 'none') after = Math.min(after, 1);
        if (after === before) return [];
        if (after === 0) {
          delete u.statuses[id];
          return [{ type: 'StatusRemoved', unit: u.id, side: u.side, status: id }];
        }
        u.statuses[id] = after;
        return [{ type: 'StatusChanged', unit: u.id, side: u.side, status: id, stacks: after, delta: after - before }];
      },
    },

    ops: {
      applyStatus: defineOp(
        {
          displayName: 'Apply status',
          description: 'Give a unit (the target) stacks of a status.',
          params: z.object({ unit: z.string().min(1).optional(), status: z.string().min(1), stacks: z.number().int().min(1) }),
          text: 'Apply {stacks} {status}.',
          widgets: { unit: 'unit', status: 'status', stacks: 'number' },
          category: 'statuses',
        },
        (ctx, p) => {
          const unit = str(p.unit ?? ctx.item.vars.target);
          if (ctx.state.world.board.units[unit]) ctx.step({ kind: 'status', unit, status: p.status, delta: p.stacks });
        },
      ),
      removeStatus: defineOp(
        {
          displayName: 'Remove status',
          description: 'Remove stacks of a status from a unit (the holder or target); all of them if no count is given.',
          params: z.object({ unit: z.string().min(1).optional(), status: z.string().min(1), stacks: z.number().int().min(1).optional() }),
          text: 'Remove {status}.',
          widgets: { unit: 'unit', status: 'status', stacks: 'number' },
          category: 'statuses',
        },
        (ctx, p) => {
          const unit = str(p.unit ?? ctx.item.vars.holder ?? ctx.item.vars.target);
          const current = ctx.state.world.board.units[unit]?.statuses[str(p.status)] ?? 0;
          if (current > 0) ctx.step({ kind: 'status', unit, status: p.status, delta: -((p.stacks as number | undefined) ?? current) });
        },
      ),
      // Internal: a side's duration statuses lose a stack when it ends a phase.
      tickStatuses(ctx) {
        const side = (ctx.item.vars.event as GameEvent).activeSide;
        const steps: Step[] = [];
        for (const u of Object.values(ctx.state.world.board.units)) {
          if (u.side !== side) continue;
          for (const status of Object.keys(u.statuses)) {
            if (def(status).stacking === 'duration') steps.push({ kind: 'status', unit: u.id, status, delta: -1 });
          }
        }
        if (steps.length > 0) ctx.step(steps);
      },
    },

    listeners(state) {
      const out: Listener<W>[] = [];
      const units = Object.values(state.world.board.units);

      for (const holder of units) {
        for (const [status, stacks] of Object.entries(holder.statuses)) {
          (def(status).hooks ?? []).forEach((hook, i) => {
            const base = {
              id: `status:${status}:${holder.id}:${i}`,
              source: holder.id,
              controller: holder.side,
              layer: 'status' as const,
              timestamp: holder.createdAt,
              vars: { holder: holder.id, self: holder.id, stacks },
              matches: (e: GameEvent) =>
                e.type === hook.on && related(e, holder, hook.scope) && (hook.phase === undefined || e.phase === hook.phase),
              effects: hook.effects,
            };
            out.push(hook.timing === 'when' ? { ...base, kind: 'interrupt' } : { ...base, kind: 'trigger' });
          });
        }
      }

      if (units.some((u) => Object.keys(u.statuses).some((s) => defs[s]?.stacking === 'duration'))) {
        out.push({
          kind: 'trigger',
          id: 'statuses:tick',
          source: null,
          controller: null,
          layer: 'rules',
          timestamp: 0,
          matches: (e) => e.type === 'PhaseEnded' && e.activeSide !== null,
          effects: [{ op: 'tickStatuses' }],
          vars: {},
        });
      }

      out.push({
        kind: 'modifier',
        id: 'statuses:damage',
        source: null,
        controller: null,
        layer: 'status',
        timestamp: 0,
        matches: (s, st) =>
          s.kind === 'damage' &&
          (s.amount as number) > 0 &&
          damageChange(st.world.board.units[str(s.unit)], st.world.board.units[str(s.by)]).any,
        modify(s, st) {
          const { add, multiply } = damageChange(st.world.board.units[str(s.unit)], st.world.board.units[str(s.by)]);
          return [{ ...s, amount: Math.max(0, Math.floor(((s.amount as number) + add) * multiply)) }];
        },
      });
      return out;
    },
  };
}
