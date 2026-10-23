import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { OpRegistry, effectSchemaFor, renderText, type OpMeta } from './ops.js';

const damage: OpMeta = {
  id: 'damage',
  displayName: 'Damage',
  description: 'Deal damage.',
  params: z.object({ amount: z.number().int().min(0), target: z.string().optional() }),
  text: 'Deal {amount} damage.',
};

describe('OpRegistry', () => {
  it('lists ops sorted by id and accepts namespaced package ops', () => {
    const ops = new OpRegistry().register({ ...damage, id: 'my-pack:zapAll' }).register(damage);
    expect(ops.list().map((o) => o.id)).toEqual(['damage', 'my-pack:zapAll']);
    expect(ops.get('my-pack:zapAll')?.displayName).toBe('Damage');
  });

  it('rejects duplicates, bad ids and a parameter named op', () => {
    const ops = new OpRegistry().register(damage);
    expect(() => ops.register(damage)).toThrow(/already registered/);
    expect(() => ops.register({ ...damage, id: 'Bad Id' })).toThrow(/not a valid op id/);
    expect(() => ops.register({ ...damage, id: 'x', params: z.object({ op: z.string() }) })).toThrow(/named 'op'/);
  });
});

describe('effectSchemaFor', () => {
  const schema = effectSchemaFor(damage);

  it('accepts literal values or variable references for every parameter', () => {
    expect(schema.safeParse({ op: 'damage', amount: 3 }).success).toBe(true);
    expect(schema.safeParse({ op: 'damage', amount: { $: 'event.amount' }, target: { $: 'event.unit' } }).success).toBe(true);
  });

  it('keeps optional parameters optional and rejects unknown ones', () => {
    expect(schema.safeParse({ op: 'damage' }).success).toBe(false);
    expect(schema.safeParse({ op: 'damage', amount: 1, extra: true }).success).toBe(false);
    expect(schema.safeParse({ op: 'damage', amount: -1 }).success).toBe(false);
  });
});

describe('renderText', () => {
  it('fills parameters, shows variables as X and missing ones as ?', () => {
    expect(renderText(damage, { amount: 6 })).toBe('Deal 6 damage.');
    expect(renderText(damage, { amount: { $: 'stacks' } })).toBe('Deal X damage.');
    expect(renderText(damage, {})).toBe('Deal ? damage.');
  });

  it('pluralizes with {name:one|many}', () => {
    const draw = { ...damage, text: 'Draw {n:card|cards}.' };
    expect(renderText(draw, { n: 1 })).toBe('Draw 1 card.');
    expect(renderText(draw, { n: 3 })).toBe('Draw 3 cards.');
    expect(renderText(draw, { n: { $: 'x' } })).toBe('Draw X cards.');
  });
});
