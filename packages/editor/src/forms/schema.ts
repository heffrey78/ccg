/**
 * The form engine's model (#40): reads JSON Schema (generated from the content
 * and op Zod schemas) one node at a time and says what control to draw, so
 * the editor builds forms for any item, and for any op's parameters,
 * including ops from game packages it has never seen.
 */
import { z } from 'zod';
import { type ContentKind, type OpMeta, type WidgetHint } from '@ccg/content';

export type JsonSchema = {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  pattern?: string;
  description?: string;
  default?: unknown;
};

/** What control a schema node needs. Children stay as schema nodes and are described when drawn. */
export type FieldSpec =
  | { kind: 'string'; minLength: number; pattern?: string }
  | { kind: 'number'; integer: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'enum'; options: (string | number)[] }
  | { kind: 'const'; value: unknown }
  | { kind: 'object'; fields: { key: string; node: JsonSchema; required: boolean }[] }
  | { kind: 'record'; value: JsonSchema; keyPattern?: string }
  | { kind: 'array'; item: JsonSchema; minItems: number }
  /** A union; `tag` is the property whose constant tells the options apart, when there is one. */
  | { kind: 'union'; options: JsonSchema[]; tag?: string; labels: string[] }
  | { kind: 'unknown' };

/** Follows `$ref`s against the root's `$defs`. */
export function deref(node: JsonSchema, root: JsonSchema): JsonSchema {
  let current = node;
  for (let i = 0; current.$ref && i < 50; i++) {
    const name = current.$ref.replace(/^#\/\$defs\//, '');
    const target = root.$defs?.[name];
    if (!target) return {};
    current = target;
  }
  return current;
}

const constOf = (node: JsonSchema, key: string, root: JsonSchema) => {
  const prop = node.properties?.[key];
  return prop ? deref(prop, root).const : undefined;
};

export function describe(input: JsonSchema, root: JsonSchema): FieldSpec {
  const node = deref(input, root);
  if (node.const !== undefined) return { kind: 'const', value: node.const };
  if (node.enum) return { kind: 'enum', options: node.enum as (string | number)[] };
  const options = node.oneOf ?? node.anyOf;
  if (options) {
    const resolved = options.map((o) => deref(o, root));
    // A discriminated union: every option is an object with the same constant property.
    const first = resolved[0];
    const tag = first?.properties ? Object.keys(first.properties).find((k) => resolved.every((o) => constOf(o, k, root) !== undefined)) : undefined;
    const labels = resolved.map((o, i) => (tag ? String(constOf(o, tag, root)) : optionLabel(o, i)));
    return { kind: 'union', options: resolved, labels, ...(tag && { tag }) };
  }
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (type) {
    case 'string':
      return { kind: 'string', minLength: node.minLength ?? 0, ...(node.pattern && { pattern: node.pattern }) };
    case 'integer':
    case 'number': {
      const min = node.minimum ?? (node.exclusiveMinimum !== undefined ? node.exclusiveMinimum : undefined);
      const max = node.maximum !== undefined && node.maximum < Number.MAX_SAFE_INTEGER ? node.maximum : undefined;
      return { kind: 'number', integer: type === 'integer', ...(min !== undefined && { min }), ...(max !== undefined && { max }) };
    }
    case 'boolean':
      return { kind: 'boolean' };
    case 'array':
      return { kind: 'array', item: node.items ?? {}, minItems: (node as { minItems?: number }).minItems ?? 0 };
    case 'object': {
      if (node.properties) {
        const required = new Set(node.required ?? []);
        return { kind: 'object', fields: Object.entries(node.properties).map(([key, n]) => ({ key, node: n, required: required.has(key) })) };
      }
      if (typeof node.additionalProperties === 'object') {
        const keyPattern = (node as { propertyNames?: JsonSchema }).propertyNames?.pattern;
        return { kind: 'record', value: node.additionalProperties, ...(keyPattern && { keyPattern }) };
      }
      return { kind: 'object', fields: [] };
    }
  }
  return { kind: 'unknown' };
}

function optionLabel(node: JsonSchema, index: number): string {
  if (node.type === 'array') return 'list';
  if (node.type === 'object' && node.properties && '$' in node.properties) return 'variable';
  return typeof node.type === 'string' ? node.type : `option ${index + 1}`;
}

/**
 * A starting value for a node: what "add" or "switch option" fills in. It
 * aims to be valid: numbers start at their minimum, enums at their first
 * option, objects with their required fields, unions with their first option.
 */
export function defaultValue(input: JsonSchema, root: JsonSchema, depth = 0): unknown {
  const node = deref(input, root);
  if (node.default !== undefined) return structuredClone(node.default);
  const spec = describe(node, root);
  switch (spec.kind) {
    case 'const':
      return spec.value;
    case 'enum':
      return spec.options[0];
    case 'string':
      return spec.minLength > 0 ? 'x'.repeat(spec.minLength) : '';
    case 'number':
      return spec.min !== undefined ? (spec.integer ? Math.ceil(spec.min) : spec.min) : 0;
    case 'boolean':
      return false;
    case 'array':
      return depth > 8 || spec.minItems === 0 ? [] : Array.from({ length: spec.minItems }, () => defaultValue(spec.item, root, depth + 1));
    case 'record':
      return {};
    case 'object':
      return Object.fromEntries(spec.fields.filter((f) => f.required).map((f) => [f.key, defaultValue(f.node, root, depth + 1)]));
    case 'union':
      return spec.options[0] ? defaultValue(spec.options[0], root, depth + 1) : null;
    case 'unknown':
      return null;
  }
}

/** Which option of a union a value matches: by tag, else by JSON type. */
export function matchOption(spec: Extract<FieldSpec, { kind: 'union' }>, value: unknown, root: JsonSchema): number {
  if (spec.tag && typeof value === 'object' && value !== null) {
    const tag = (value as Record<string, unknown>)[spec.tag];
    const i = spec.options.findIndex((o) => constOf(o, spec.tag as string, root) === tag);
    if (i >= 0) return i;
  }
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value;
  const isVar = typeof value === 'object' && value !== null && '$' in value;
  const i = spec.options.findIndex((o) => {
    const t = Array.isArray(o.type) ? o.type[0] : o.type;
    if (isVar) return t === 'object' && o.properties !== undefined && '$' in o.properties;
    return t === kind || (kind === 'number' && t === 'integer') || (o.enum?.includes(value as never) ?? false);
  });
  return Math.max(0, i);
}

// ---- widget hints for item fields ----

/** Fields of content items that take a reference or a special control, by kind and pointer pattern (`*` = any segment). */
const ITEM_HINTS: Record<ContentKind, [string, WidgetHint][]> = {
  card: [
    ['/keywords/*', 'status'],
    ['/permanent/unit', 'unitDef'],
  ],
  unit: [['/statuses/*/status', 'status']],
  status: [],
  tile: [],
  encounter: [
    ['/units/*/unit', 'unitDef'],
    ['/tiles/*', 'tileDef'],
    ['/rewards/cards/*', 'cardDef'],
  ],
  ruleset: [
    ['/player/deck/*', 'cardDef'],
    ['/run/encounters/*', 'encounterDef'],
    ['/run/map/nodes/*/encounter', 'encounterDef'],
    ['/run/rewards/pool/*', 'cardDef'],
  ],
  scenario: [
    ['/encounter', 'encounterDef'],
    ['/hand/*', 'cardDef'],
    ['/deck/*', 'cardDef'],
    ['/expect/*/unit', 'unitDef'],
    ['/expect/*/status', 'status'],
  ],
  theme: [],
};

/** Hints by field name, wherever it appears. */
const NAME_HINTS: Record<string, WidgetHint> = {
  effects: 'effects',
  onEnter: 'effects',
  then: 'effects',
  else: 'effects',
  cost: 'cost',
  shape: 'pattern',
  area: 'pattern',
  art: 'asset',
  background: 'asset',
  icon: 'asset',
  font: 'asset',
  behavior: 'behavior',
};

export function itemHint(kind: ContentKind, pointer: string): WidgetHint | undefined {
  const parts = pointer.split('/');
  for (const [pattern, hint] of ITEM_HINTS[kind]) {
    const want = pattern.split('/');
    if (want.length === parts.length && want.every((w, i) => w === '*' || w === parts[i])) return hint;
  }
  return NAME_HINTS[parts.at(-1) ?? ''];
}

// ---- schemas for forms ----

const cache = new WeakMap<object, JsonSchema>();

/** JSON Schema for a Zod schema, cached per schema object. */
export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  let out = cache.get(schema);
  if (!out) {
    out = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema;
    cache.set(schema, out);
  }
  return out;
}

/** An op's parameter schema, for its form. Nested effect lists use the `effects` widget, not this schema. */
export const opParamsSchema = (meta: OpMeta): JsonSchema => jsonSchemaOf(meta.params);

/** A new effect for an op, as the palette adds it: the op plus its required parameters. */
export function defaultEffect(meta: OpMeta): Record<string, unknown> {
  const root = opParamsSchema(meta);
  const spec = describe(root, root);
  const effect: Record<string, unknown> = { op: meta.id };
  if (spec.kind !== 'object') return effect;
  for (const f of spec.fields) {
    if (!f.required) continue;
    const hint = meta.widgets?.[f.key];
    effect[f.key] = hint === 'effects' ? [] : hint === 'unit' || hint === 'tile' || hint === 'card' ? { $: 'target' } : defaultValue(f.node, root);
  }
  return effect;
}

export interface PaletteGroup {
  category: string;
  ops: OpMeta[];
}

/** Ops grouped by category for the effect palette, filtered by a search over id, name and description. */
export function palette(ops: OpMeta[], query = ''): PaletteGroup[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, OpMeta[]>();
  for (const op of ops) {
    if (q && ![op.id, op.displayName, op.description].some((s) => s.toLowerCase().includes(q))) continue;
    const category = op.category ?? 'other';
    groups.set(category, [...(groups.get(category) ?? []), op]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({ category, ops: list.sort((a, b) => a.displayName.localeCompare(b.displayName)) }));
}
