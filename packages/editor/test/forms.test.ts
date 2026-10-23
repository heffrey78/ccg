import { describe as group, expect, it } from 'vitest';
import { z } from 'zod';
import { OpRegistry, createContentSchemas, effectSchemaFor } from '@ccg/content';
import { editorOps } from '../src/index.js';
import { defaultEffect, defaultValue, describe, itemHint, jsonSchemaOf, matchOption, opParamsSchema, palette } from '../src/forms/schema.js';
import { guessBoard, offsetPath, previewCells, previewSetup, type PreviewBoard } from '../src/forms/patterns.js';

const ops = editorOps();
const schemas = createContentSchemas(ops);

group('op forms', () => {
  it.each(ops.list().map((op) => [op.id, op] as const))('%s: every parameter gets a control, and a new effect is valid', (_id, meta) => {
    const root = opParamsSchema(meta);
    const spec = describe(root, root);
    expect(spec.kind).toBe('object');
    if (spec.kind !== 'object') return;
    expect(spec.fields.map((f) => f.key).sort()).toEqual(Object.keys(meta.params.shape).sort());
    for (const f of spec.fields) {
      // Effect lists have their own composer; everything else is described by its schema.
      if (meta.widgets?.[f.key] === 'effects') continue;
      expect(describe(f.node, root).kind, `${meta.id}.${f.key}`).not.toBe('unknown');
    }
    const effect = defaultEffect(meta);
    const checked = effectSchemaFor(meta, schemas.effect).safeParse(effect);
    expect(checked.success, JSON.stringify(checked.error?.issues)).toBe(true);
  });

  it('a custom op registered by a package appears in the palette with a working form, with no editor code', () => {
    const custom = new OpRegistry().register({
      id: 'mygame:summonStorm',
      displayName: 'Summon storm',
      description: 'Call lightning on a tile.',
      params: z.object({ strikes: z.number().int().min(1), element: z.enum(['fire', 'ice']), pos: z.string().min(1) }),
      text: 'Summon a storm of {strikes}.',
      widgets: { pos: 'tile' },
      category: 'weather',
    });
    const groups = palette(custom.list(), 'storm');
    expect(groups).toEqual([{ category: 'weather', ops: [custom.get('mygame:summonStorm')] }]);
    const meta = custom.get('mygame:summonStorm')!;
    expect(defaultEffect(meta)).toEqual({ op: 'mygame:summonStorm', strikes: 1, element: 'fire', pos: { $: 'target' } });
    expect(effectSchemaFor(meta).safeParse(defaultEffect(meta)).success).toBe(true);
  });

  it('the palette searches names and descriptions and groups by category', () => {
    const groups = palette(ops.list(), 'block');
    expect(groups.flatMap((g) => g.ops.map((o) => o.id))).toContain('gainBlock');
    expect(palette(ops.list()).map((g) => g.category)).toEqual([...palette(ops.list()).map((g) => g.category)].sort());
  });
});

group('item forms', () => {
  it('describes every card field, and hints the special ones', () => {
    const root = jsonSchemaOf(schemas.card);
    const spec = describe(root, root);
    if (spec.kind !== 'object') throw new Error('card is not an object');
    for (const f of spec.fields) expect(describe(f.node, root).kind, f.key).not.toBe('unknown');
    expect(itemHint('card', '/effects')).toBe('effects');
    expect(itemHint('card', '/cost')).toBe('cost');
    expect(itemHint('card', '/keywords/0')).toBe('status');
    expect(itemHint('card', '/upgrade/effects')).toBe('effects');
    expect(itemHint('encounter', '/units/2/unit')).toBe('unitDef');
    expect(itemHint('card', '/targeting/shape')).toBe('pattern');
  });

  it('unions are told apart by their tag; switching option fills valid defaults', () => {
    const root = jsonSchemaOf(schemas.card);
    const targeting = describe((root.properties as Record<string, object>).targeting as object, root);
    if (targeting.kind !== 'union') throw new Error('targeting is not a union');
    expect(targeting.tag).toBe('kind');
    expect(targeting.labels).toEqual(['none', 'self', 'unit', 'tile', 'direction', 'pattern']);
    expect(matchOption(targeting, { kind: 'tile', range: 2 }, root)).toBe(3);
    const pattern = defaultValue(targeting.options[5]!, root);
    expect(pattern).toEqual({ kind: 'pattern', shape: { kind: 'self' } });
    expect(schemas.card.shape.targeting.safeParse(pattern).success).toBe(true);
  });

  it('every kind of item can be built from defaults', () => {
    for (const kind of ['card', 'unit', 'status', 'tile', 'encounter', 'ruleset'] as const) {
      const root = jsonSchemaOf(schemas[kind]);
      const value = { ...(defaultValue(root, root) as object), id: 'x', name: 'X' };
      const checked = schemas[kind].safeParse(value);
      expect(checked.success, `${kind}: ${JSON.stringify(checked.error?.issues)}`).toBe(true);
    }
  });
});

group('pattern picker', () => {
  const boards: PreviewBoard[] = ['lane', 'square', 'hex'];
  const shapes = [
    { kind: 'self' },
    { kind: 'adjacent' },
    { kind: 'line', length: 3 },
    { kind: 'cone', length: 2 },
    { kind: 'ring', radius: 2 },
    { kind: 'area', radius: 1, includeOrigin: true },
  ] as const;

  it.each(boards)('%s: the preview is exactly the topology pattern', (board) => {
    const setup = previewSetup(board);
    for (const shape of shapes) expect(previewCells(setup, shape)).toEqual(setup.topology.pattern(setup.origin, setup.facing, shape));
  });

  it.each(boards)('%s: clicking any cell gives offsets that select exactly that cell', (board) => {
    const setup = previewSetup(board);
    for (const cell of setup.topology.positions()) {
      if (cell === setup.origin) continue;
      const path = offsetPath(setup, cell);
      expect(path, cell).not.toBeNull();
      expect(previewCells(setup, { kind: 'offsets', offsets: [path as number[]] })).toEqual([cell]);
    }
  });

  it('guesses the board from encounter positions', () => {
    expect(guessBoard(['0', '6'])).toBe('lane');
    expect(guessBoard(['1,3', '5,3'])).toBe('square');
    expect(guessBoard(['0,-1', '1,0'])).toBe('hex');
  });
});
