/**
 * Responding to items on the stack (#57, resolution-order §5.3): counter,
 * redirect, modify parameters, and add effects before or after. Each acts on
 * the item the response was played against (`respondingTo`), or else the
 * current top of the stack.
 */
import { z } from 'zod';
import type { Effect, EffectContext, ParamMod, StackItem } from '../kernel/types.js';
import { defineOp, type RulesModule } from './compose.js';

const effects = z.array(z.object({ op: z.string() }).loose());
const itemRef = z.string().min(1).optional();

export function stackModule<W>(): RulesModule<W> {
  const target = (ctx: EffectContext<W>, p: Record<string, unknown>): StackItem | undefined => {
    const id = (p.item ?? ctx.item.vars.respondingTo ?? ctx.state.stack.at(-1)?.id) as string | undefined;
    return ctx.state.stack.find((i) => i.id === id);
  };
  const find = (stack: StackItem[], id: unknown) => stack.find((i) => i.id === id);

  return {
    name: 'stack',
    steps: {
      counterItem(state, s) {
        const item = find(state.stack, s.item);
        if (!item || item.countered) return [];
        item.countered = true;
        return [{ type: 'ItemCounterMarked', item: item.id }];
      },
      retargetItem(state, s) {
        const item = find(state.stack, s.item);
        if (!item) return [];
        item.vars.target = s.target;
        return [{ type: 'ItemRedirected', item: item.id, target: s.target }];
      },
      modifyItem(state, s) {
        const item = find(state.stack, s.item);
        if (!item) return [];
        item.mods = [...(item.mods ?? []), s.mod as ParamMod];
        return [{ type: 'ItemModified', item: item.id, mod: s.mod }];
      },
      amendItem(state, s) {
        const item = find(state.stack, s.item);
        if (!item) return [];
        item.effects = [...((s.before as Effect[] | undefined) ?? []), ...item.effects, ...((s.after as Effect[] | undefined) ?? [])];
        return [{ type: 'ItemAmended', item: item.id }];
      },
    },
    ops: {
      counter: defineOp(
        {
          displayName: 'Counter',
          description: 'The item you are responding to does nothing when it would resolve.',
          params: z.object({ item: itemRef }),
          text: 'Counter it.',
          category: 'responses',
        },
        (ctx, p) => {
          const item = target(ctx, p);
          if (item) ctx.step({ kind: 'counterItem', item: item.id });
        },
      ),
      redirect: defineOp(
        {
          displayName: 'Redirect',
          description: 'Change the target of the item you are responding to.',
          params: z.object({ item: itemRef, to: z.string().min(1) }),
          text: 'Redirect it.',
          widgets: { to: 'unit' },
          category: 'responses',
        },
        (ctx, p) => {
          const item = target(ctx, p);
          if (item) ctx.step({ kind: 'retargetItem', item: item.id, target: p.to });
        },
      ),
      modify: defineOp(
        {
          displayName: 'Modify',
          description: 'Change a parameter of one kind of effect in the item you are responding to, e.g. damage −2.',
          params: z.object({
            item: itemRef,
            effect: z.string().min(1),
            param: z.string().min(1),
            add: z.number().optional(),
            multiply: z.number().optional(),
          }),
          text: 'Change its {param} by {add}.',
          category: 'responses',
        },
        (ctx, p) => {
          const item = target(ctx, p);
          if (!item) return;
          const mod: ParamMod = { op: p.effect as string, param: p.param as string };
          if (p.add !== undefined) mod.add = p.add as number;
          if (p.multiply !== undefined) mod.multiply = p.multiply as number;
          ctx.step({ kind: 'modifyItem', item: item.id, mod });
        },
      ),
      addBefore: defineOp(
        {
          displayName: 'Add before',
          description: 'Run extra effects just before the item you are responding to, as part of it.',
          params: z.object({ item: itemRef, effects }),
          text: 'First: {effects}',
          widgets: { effects: 'effects' },
          category: 'responses',
        },
        (ctx, p) => {
          const item = target(ctx, p);
          if (item) ctx.step({ kind: 'amendItem', item: item.id, before: p.effects });
        },
      ),
      addAfter: defineOp(
        {
          displayName: 'Add after',
          description: 'Run extra effects just after the item you are responding to, as part of it.',
          params: z.object({ item: itemRef, effects }),
          text: 'Then: {effects}',
          widgets: { effects: 'effects' },
          category: 'responses',
        },
        (ctx, p) => {
          const item = target(ctx, p);
          if (item) ctx.step({ kind: 'amendItem', item: item.id, after: p.effects });
        },
      ),
    },
  };
}
