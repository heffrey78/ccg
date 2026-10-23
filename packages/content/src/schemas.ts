/**
 * Schemas for the manifest and each kind of content item (#34). They are built
 * from an op registry because effect parameters depend on which ops exist.
 *
 * These cover the fields the engine tasks need first. Later tasks extend them:
 * play timing and permanents (#57, #55), enemy behaviours (#27), visibility
 * (#56). Anything a game wants beyond the schema goes in `extensions`.
 */
import { z } from 'zod';
import { FORMAT_VERSION } from './format.js';
import { ID_PATTERN, REF_PATTERN } from './ids.js';
import { effectSchemaFor, type OpRegistry } from './ops.js';

const id = z.string().regex(ID_PATTERN, 'must be lowercase letters and digits, joined by - or _');
const ref = z.string().regex(REF_PATTERN, 'must be an id, or packageId:id for another package');
const count = z.number().int().min(0);
const assetPath = z.string().regex(/^assets\/[^\\]+$/, 'must be a path under assets/');
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'must be a semver version like 1.2.3');

export const patternShape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }).strict(),
  z.object({ kind: z.literal('adjacent') }).strict(),
  z.object({ kind: z.literal('line'), length: count }).strict(),
  z.object({ kind: z.literal('cone'), length: count }).strict(),
  z.object({ kind: z.literal('ring'), radius: count }).strict(),
  z.object({ kind: z.literal('area'), radius: count, includeOrigin: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('offsets'), offsets: z.array(z.array(z.number().int())) }).strict(),
]);

export const targeting = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('self') }).strict(),
  z
    .object({ kind: z.literal('unit'), range: count.optional(), filter: z.enum(['any', 'ally', 'enemy']).optional() })
    .strict(),
  z.object({ kind: z.literal('tile'), range: count.optional(), empty: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('direction') }).strict(),
  z.object({ kind: z.literal('pattern'), range: count.optional(), shape: patternShape }).strict(),
]);

export interface SchemaOptions {
  /** The format version files must have after migration; match the migrator's `current`. */
  formatVersion?: number;
}

export function createContentSchemas(ops: OpRegistry, { formatVersion: version = FORMAT_VERSION }: SchemaOptions = {}) {
  const formatVersion = z.literal(version);
  const variants = ops.list().map(effectSchemaFor);
  const effect: z.ZodType =
    variants.length === 0
      ? z.never()
      : variants.length === 1
        ? (variants[0] as z.ZodObject)
        : z.discriminatedUnion('op', variants as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]);
  const effects = z.array(effect);

  const common = {
    formatVersion,
    id,
    name: z.string().min(1),
    tags: z.array(z.string()).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  };

  const cost = z.record(id, count);

  const card = z
    .object({
      ...common,
      kind: z.literal('card'),
      cost: cost.optional(),
      rarity: z.enum(['basic', 'common', 'uncommon', 'rare', 'special']).optional(),
      keywords: z.array(ref).optional(),
      targeting,
      effects,
      upgrade: z
        .object({ name: z.string().min(1).optional(), cost: cost.optional(), effects: effects.optional() })
        .strict()
        .optional(),
      /** Overrides the generated card text. */
      text: z.string().optional(),
      art: assetPath.optional(),
    })
    .strict();

  const unit = z
    .object({
      ...common,
      kind: z.literal('unit'),
      hp: z.number().int().min(1),
      faction: id.optional(),
      statuses: z.array(z.object({ status: ref, stacks: z.number().int().min(1) }).strict()).optional(),
      art: assetPath.optional(),
    })
    .strict();

  const status = z
    .object({
      ...common,
      kind: z.literal('status'),
      description: z.string().optional(),
      stacking: z.enum(['intensity', 'duration', 'none']),
      hooks: z
        .array(
          z
            .object({ on: z.string().min(1), timing: z.enum(['when', 'after']).optional(), effects })
            .strict(),
        )
        .optional(),
      icon: assetPath.optional(),
    })
    .strict();

  const tile = z
    .object({
      ...common,
      kind: z.literal('tile'),
      blocking: z.boolean().optional(),
      /** Effects applied to a unit entering the tile. */
      onEnter: effects.optional(),
      art: assetPath.optional(),
    })
    .strict();

  const encounter = z
    .object({
      ...common,
      kind: z.literal('encounter'),
      /** Board position → tile id, for tiles that differ from the default. */
      tiles: z.record(z.string(), ref).optional(),
      units: z.array(
        z.object({ unit: ref, side: id, pos: z.string().min(1), facing: z.string().min(1).optional() }).strict(),
      ),
      rewards: z.object({ cards: z.array(ref).optional() }).strict().optional(),
    })
    .strict();

  const item = z.discriminatedUnion('kind', [card, unit, status, tile, encounter]);

  const manifest = z
    .object({
      formatVersion,
      id,
      name: z.string().min(1),
      version: semver,
      /** Engine API range this package works with (checked by the loader in #25). */
      engine: z.string().min(1),
      depends: z.record(id, z.string().min(1)).optional(),
      description: z.string().optional(),
    })
    .strict();

  return { effect, card, unit, status, tile, encounter, item, manifest };
}

export type ContentSchemas = ReturnType<typeof createContentSchemas>;
export type ContentKind = 'card' | 'unit' | 'status' | 'tile' | 'encounter';
export const CONTENT_KINDS: readonly ContentKind[] = ['card', 'unit', 'status', 'tile', 'encounter'];

export interface ContentItem {
  formatVersion: number;
  kind: ContentKind;
  id: string;
  name: string;
  [field: string]: unknown;
}

export interface Manifest {
  formatVersion: number;
  id: string;
  name: string;
  version: string;
  engine: string;
  depends?: Record<string, string>;
  description?: string;
}
