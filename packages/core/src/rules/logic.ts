/**
 * Control flow and variables for effects (#24): conditions, `if`, `repeat`
 * and `setVar`. Branches are nested effect lists; their variable references
 * resolve when they run (§3.1), so they see variables set before them.
 */
import { varRef } from '@ccg/content';
import { z } from 'zod';
import { defineOp, type RulesModule } from './compose.js';

const value = z.union([z.number(), z.string(), z.boolean(), z.null(), varRef]);

export type Condition =
  | { kind: 'compare'; left: unknown; cmp: '<' | '<=' | '==' | '!=' | '>=' | '>'; right: unknown }
  | { kind: 'truthy'; value: unknown }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'not'; cond: Condition };

export const condition: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    // `cmp`, not `op`: an object with an `op` field is an effect (see kernel/params.ts).
    z.object({ kind: z.literal('compare'), left: value, cmp: z.enum(['<', '<=', '==', '!=', '>=', '>']), right: value }).strict(),
    z.object({ kind: z.literal('truthy'), value }).strict(),
    z.object({ kind: z.literal('all'), of: z.array(condition) }).strict(),
    z.object({ kind: z.literal('any'), of: z.array(condition) }).strict(),
    z.object({ kind: z.literal('not'), cond: condition }).strict(),
  ]),
) as z.ZodType<Condition>;

/** Evaluates a condition whose variable references are already resolved. */
export function evaluate(cond: Condition): boolean {
  switch (cond.kind) {
    case 'compare': {
      const { left, right } = cond;
      switch (cond.cmp) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        default: {
          if (typeof left !== 'number' || typeof right !== 'number') return false;
          return cond.cmp === '<' ? left < right : cond.cmp === '<=' ? left <= right : cond.cmp === '>=' ? left >= right : left > right;
        }
      }
    }
    case 'truthy':
      return Boolean(cond.value) && cond.value !== 0;
    case 'all':
      return cond.of.every(evaluate);
    case 'any':
      return cond.of.some(evaluate);
    case 'not':
      return !evaluate(cond.cond);
  }
}

/** Placeholder schema for nested effect lists; content validation substitutes the full effect schema. */
const effects = z.array(z.object({ op: z.string() }).loose());

export function logicModule<W>(): RulesModule<W> {
  return {
    name: 'logic',
    ops: {
      if: defineOp(
        {
          displayName: 'If',
          description: 'Run some effects only when a condition holds, and optionally others when it does not.',
          params: z.object({ cond: condition, then: effects, else: effects.optional() }),
          text: 'If {cond}: {then}',
          widgets: { cond: 'condition', then: 'effects', else: 'effects' },
          category: 'logic',
        },
        (ctx, p) => {
          const branch = evaluate(p.cond as Condition) ? p.then : p.else;
          if (Array.isArray(branch)) ctx.run(branch as never);
        },
      ),
      repeat: defineOp(
        {
          displayName: 'Repeat',
          description: 'Run some effects several times.',
          params: z.object({ times: z.number().int().min(0), effects }),
          text: '{times}×: {effects}',
          widgets: { times: 'number', effects: 'effects' },
          category: 'logic',
        },
        (ctx, p) => {
          for (let i = 0; i < (p.times as number); i++) ctx.run(p.effects as never);
        },
      ),
      setVar: defineOp(
        {
          displayName: 'Set variable',
          description: 'Store a value for later effects of this card.',
          params: z.object({ name: z.string().min(1), value }),
          text: '',
          widgets: { name: 'text' },
          category: 'variables',
        },
        (ctx, p) => ctx.setVar(p.name as string, p.value),
      ),
    },
  };
}
