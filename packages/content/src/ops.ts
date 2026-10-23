/**
 * Self-describing effect ops (#34, decision #12). Every op, built-in or from a
 * game package, registers metadata that the validator, the card-text renderer
 * and the editor's generated forms all read.
 */
import { z } from 'zod';
import { OP_ID_PATTERN } from './ids.js';

/** A variable reference usable in place of any op parameter, e.g. `{ "$": "event.unit" }`. */
export const varRef = z.object({ $: z.string().min(1) }).strict();

/** How the editor should present a parameter. Unknown hints fall back to the schema's default widget. */
export type WidgetHint =
  | 'number'
  | 'text'
  | 'boolean'
  | 'enum'
  | 'unit'
  | 'tile'
  | 'direction'
  | 'pattern'
  /** A card instance in play. */
  | 'card'
  /** A card definition id. */
  | 'cardDef'
  /** A unit definition id. */
  | 'unitDef'
  /** A status definition id. */
  | 'status'
  | 'effects'
  | 'condition'
  | 'side'
  | (string & {});

export interface OpMeta {
  /** `name` for built-ins, `packageId:name` for package ops. */
  id: string;
  displayName: string;
  description: string;
  /** Parameter schema, without `op`. Each parameter also accepts a variable reference. */
  params: z.ZodObject;
  /** Card-text template: `{param}` is replaced by the parameter's value. */
  text: string;
  widgets?: Record<string, WidgetHint>;
  category?: string;
}

export class OpRegistry {
  readonly #ops = new Map<string, OpMeta>();

  register(meta: OpMeta): this {
    if (!OP_ID_PATTERN.test(meta.id)) throw new RangeError(`op id '${meta.id}' is not a valid op id`);
    if (this.#ops.has(meta.id)) throw new RangeError(`op '${meta.id}' is already registered`);
    for (const key of Object.keys(meta.params.shape)) {
      if (key === 'op') throw new RangeError(`op '${meta.id}' may not declare a parameter named 'op'`);
    }
    this.#ops.set(meta.id, meta);
    return this;
  }

  get(id: string): OpMeta | undefined {
    return this.#ops.get(id);
  }

  /** All ops, sorted by id. */
  list(): OpMeta[] {
    return [...this.#ops.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

/**
 * The schema for one effect of this op: `{ op, ...params }`, each parameter
 * optionally a variable. Parameters with the `effects` widget hold nested
 * effect lists and are validated against `nested`, the full effect schema.
 */
export function effectSchemaFor(meta: OpMeta, nested?: z.ZodType): z.ZodObject {
  const shape: Record<string, z.ZodType> = { op: z.literal(meta.id) };
  for (const [key, schema] of Object.entries(meta.params.shape)) {
    const optional = schema instanceof z.ZodOptional;
    if (nested && meta.widgets?.[key] === 'effects') {
      const list = z.array(nested);
      shape[key] = optional ? list.optional() : list;
      continue;
    }
    const inner = (optional ? schema.unwrap() : schema) as z.ZodType;
    const either = z.union([inner, varRef]);
    shape[key] = optional ? either.optional() : either;
  }
  return z.object(shape).strict();
}

/**
 * Renders an op's card text. `{name}` is replaced by the parameter's value and
 * `{name:card|cards}` by the value plus the singular or plural word. Variable
 * parameters show as "X" (plural); missing ones as "?".
 */
export function renderText(meta: OpMeta, params: Record<string, unknown>): string {
  return meta.text.replace(/\{(\w+)(?::([^|}]*)\|([^}]*))?\}/g, (_match, name: string, one?: string, many?: string) => {
    const value = params[name];
    const shown = format(value);
    if (one === undefined) return shown;
    return `${shown} ${value === 1 ? one : many}`;
  });
}

function format(value: unknown): string {
  if (value === undefined) return '?';
  if (typeof value === 'object' && value !== null && '$' in value) return 'X';
  if (Array.isArray(value)) return value.map(format).join(', ');
  return String(value);
}
