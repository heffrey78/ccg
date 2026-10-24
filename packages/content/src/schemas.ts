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

export type PatternShapeData = z.infer<typeof patternShape>;
export type Targeting = z.infer<typeof targeting>;

export function createContentSchemas(ops: OpRegistry, { formatVersion: version = FORMAT_VERSION }: SchemaOptions = {}) {
  const formatVersion = z.literal(version);
  // Effects can nest (an `if` op's branches), so the union refers to itself lazily.
  const effect: z.ZodType = z.lazy(() => union);
  const variants = ops.list().map((meta) => effectSchemaFor(meta, effect));
  const union: z.ZodType =
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
  const reactionCondition = z
    .object({
      kind: z.array(z.string().min(1)).optional(),
      from: z.enum(['opponent', 'self', 'any']).optional(),
      targetsYou: z.boolean().optional(),
      reaction: z.boolean().optional(),
      windows: z.array(z.enum(['itemAnnounced', 'itemTop', 'phaseEnd'])).optional(),
    })
    .strict();
  const affects = z.enum(['allies', 'enemies', 'all', 'host']);
  // Permanent abilities and statics (#58).
  const ability = z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('triggered'),
        on: z.string().min(1),
        timing: z.enum(['when', 'after']).optional(),
        scope: z.enum(['self', 'ally', 'enemy', 'any']).optional(),
        onTile: z.boolean().optional(),
        phase: z.string().min(1).optional(),
        halt: z.boolean().optional(),
        consume: z.boolean().optional(),
        effects,
      })
      .strict(),
    z
      .object({
        kind: z.literal('activated'),
        name: z.string().min(1),
        cost: cost.optional(),
        timing: z.enum(['main', 'reaction', 'any']).optional(),
        reaction: reactionCondition.optional(),
        targeting: targeting.optional(),
        oncePerTurn: z.boolean().optional(),
        effects,
      })
      .strict(),
  ]);
  const staticEffect = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('maxHp'), amount: z.number().int(), affects: affects.optional(), area: patternShape.optional() }).strict(),
    z
      .object({
        kind: z.literal('damage'),
        on: z.enum(['damageTaken', 'damageDealt']),
        add: z.number().int().optional(),
        multiply: z.number().positive().optional(),
        affects: affects.optional(),
        area: patternShape.optional(),
      })
      .strict(),
  ]);

  const card = z
    .object({
      ...common,
      kind: z.literal('card'),
      cost: cost.optional(),
      rarity: z.enum(['basic', 'common', 'uncommon', 'rare', 'special']).optional(),
      keywords: z.array(ref).optional(),
      targeting,
      effects,
      /** Goes to the exhaust zone instead of discard after it resolves. */
      exhausts: z.boolean().optional(),
      /** When it can be played (#57). */
      timing: z.enum(['main', 'reaction', 'any']).optional(),
      reaction: reactionCondition.optional(),
      faceDown: z.boolean().optional(),
      /** Becomes a permanent when it resolves (#55). */
      permanent: z
        .object({
          kind: z.enum(['unit', 'structure', 'trap', 'aura', 'attachment']),
          unit: ref.optional(),
          blocking: z.boolean().optional(),
          duration: z.number().int().min(1).optional(),
          leaveTo: z.string().min(1).optional(),
          abilities: z.array(ability).optional(),
          statics: z.array(staticEffect).optional(),
        })
        .strict()
        .optional(),
      upgrade: z
        .object({ name: z.string().min(1).optional(), cost: cost.optional(), effects: effects.optional() })
        .strict()
        .optional(),
      /** Offered as a run reward only once the deck holds cards with all these tags, e.g. a hybrid's parent strains (#101). */
      requires: z.array(z.string().min(1)).optional(),
      /** Overrides the generated card text. */
      text: z.string().optional(),
      art: assetPath.optional(),
    })
    .strict();

  // Enemy behaviour (#27): a tree choosing which intent a unit declares each round.
  const selector = z.enum(['nearestEnemy', 'weakestEnemy', 'strongestEnemy']);
  const intentTarget = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('self') }).strict(),
    z
      .object({ kind: z.literal('unit'), select: selector, range: count.optional(), bound: z.enum(['unit', 'tile']).optional() })
      .strict(),
    z.object({ kind: z.literal('pattern'), shape: patternShape, aim: z.enum(['nearestEnemy', 'facing']) }).strict(),
  ]);
  const intent = z
    .object({
      name: z.string().min(1),
      icon: assetPath.optional(),
      target: intentTarget,
      effects,
      visibility: z.enum(['full', 'partial', 'hidden']).optional(),
      onInvalidTarget: z.enum(['skip', 'retarget']).optional(),
    })
    .strict();
  type BehaviorCondition =
    | { kind: 'always' }
    | { kind: 'enemyWithin'; range: number }
    | { kind: 'hpAtMost'; fraction: number }
    | { kind: 'not'; cond: BehaviorCondition }
    | { kind: 'all' | 'any'; of: BehaviorCondition[] };
  const behaviorCondition: z.ZodType<BehaviorCondition> = z.lazy(() =>
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('always') }).strict(),
      z.object({ kind: z.literal('enemyWithin'), range: count }).strict(),
      z.object({ kind: z.literal('hpAtMost'), fraction: z.number().min(0).max(1) }).strict(),
      z.object({ kind: z.literal('not'), cond: behaviorCondition }).strict(),
      z.object({ kind: z.literal('all'), of: z.array(behaviorCondition) }).strict(),
      z.object({ kind: z.literal('any'), of: z.array(behaviorCondition) }).strict(),
    ]),
  ) as z.ZodType<BehaviorCondition>;
  const behavior: z.ZodType = z.lazy(() =>
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('intent'), intent }).strict(),
      z.object({ kind: z.literal('sequence'), steps: z.array(behavior).min(1) }).strict(),
      z
        .object({ kind: z.literal('weighted'), options: z.array(z.object({ weight: z.number().positive(), then: behavior }).strict()).min(1) })
        .strict(),
      z.object({ kind: z.literal('if'), cond: behaviorCondition, then: behavior, else: behavior }).strict(),
    ]),
  );

  const unit = z
    .object({
      ...common,
      kind: z.literal('unit'),
      hp: z.number().int().min(1),
      faction: id.optional(),
      statuses: z.array(z.object({ status: ref, stacks: z.number().int().min(1) }).strict()).optional(),
      behavior: behavior.optional(),
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
            .object({
              on: z.string().min(1),
              timing: z.enum(['when', 'after']).optional(),
              scope: z.enum(['self', 'ally', 'enemy', 'any']).optional(),
              phase: z.string().min(1).optional(),
              effects,
            })
            .strict(),
        )
        .optional(),
      modifiers: z
        .array(
          z
            .object({
              on: z.enum(['damageTaken', 'damageDealt']),
              add: z.number().int().optional(),
              perStack: z.number().int().optional(),
              multiply: z.number().positive().optional(),
            })
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

  // How a content-only game plays (decision #87): the standard game builds its rules from this.
  const size = (max: number) => z.number().int().min(1).max(max);
  const ruleset = z
    .object({
      ...common,
      kind: z.literal('ruleset'),
      board: z.discriminatedUnion('topology', [
        z.object({ topology: z.literal('lane'), length: size(64) }).strict(),
        z.object({ topology: z.literal('square'), width: size(64), height: size(64), connectivity: z.union([z.literal(4), z.literal(8)]).optional() }).strict(),
        z.object({ topology: z.literal('hex'), radius: z.number().int().min(0).max(32) }).strict(),
      ]),
      /** What a forced move does when it hits something. */
      collision: z.enum(['stop', 'bump', 'chain']).optional(),
      bumpDamage: count.optional(),
      /** Pushing off the edge: a wall, or the unit falls. */
      edge: z.enum(['wall', 'fall']).optional(),
      fog: z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('distance'), range: count }).strict(),
          z.object({ kind: z.literal('lineOfSight'), range: count.optional(), unitsBlock: z.boolean().optional() }).strict(),
        ])
        .optional(),
      /** A basic move action, separate from cards. */
      move: z.object({ range: size(64), oncePerTurn: z.boolean().optional() }).strict().optional(),
      player: z
        .object({
          side: id.optional(),
          /** Each resource is set to this at the start of the player's turn. */
          resources: z.record(id, count),
          handSize: count,
          deck: z.array(ref),
          /** Keep unplayed cards between turns (default: discard the hand). */
          keepHand: z.boolean().optional(),
          /** Keep block between turns (default: block is lost at the start of the turn). */
          keepBlock: z.boolean().optional(),
        })
        .strict(),
      enemy: z.object({ side: id.optional() }).strict().optional(),
      /** Response windows (#57): when the other side may answer an item on the stack. */
      responses: z.object({ itemAnnounced: z.boolean().optional(), itemTop: z.boolean().optional() }).strict().optional(),
      permanents: z.object({ maxPerSide: count.optional(), summoningSickness: z.boolean().optional() }).strict().optional(),
      /** `turn`: players may take back actions within their turn unless something was revealed (#83). */
      undo: z.enum(['off', 'turn']).optional(),
      /** A run (#45): encounters played in order, with a card reward after each win. */
      run: z
        .object({
          /** Encounters in order; or give a `map` for a branching run. */
          encounters: z.array(ref).min(1).optional(),
          /** A branching run (#100): nodes the player walks from `start`, choosing among each node's `next`. */
          map: z
            .object({
              start: id,
              nodes: z
                .array(
                  z
                    .object({
                      id,
                      kind: z.enum(['fight', 'elite', 'boss', 'junction', 'spring', 'fruiting']),
                      /** The fight at fight, elite and boss nodes. */
                      encounter: ref.optional(),
                      next: z.array(id),
                    })
                    .strict(),
                )
                .min(1),
            })
            .strict()
            .optional(),
          /** Tags that mark card families (strains, #101): a card tagged with one is offered only once its strains are connected. */
          strains: z.array(z.string().min(1)).optional(),
          /** How many strains, chosen at random, are connected when the run starts. */
          startStrains: count.optional(),
          /** Cards offered after a win; an encounter's own `rewards.cards` replace this pool. */
          rewards: z.object({ pool: z.array(ref), choices: z.number().int().min(1).optional() }).strict().optional(),
          /** Player units keep their HP between encounters (default true). */
          carryHp: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict();

  // What a scenario checks after its actions (#46), so scenarios run as regression tests.
  const between = z.object({ min: z.number().optional(), max: z.number().optional() }).strict();
  const expectation = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('outcome'), winner: z.enum(['player', 'enemy', 'none']) }).strict(),
    z
      .object({
        kind: z.literal('unit'),
        unit: ref,
        side: id.optional(),
        /** false: no such unit is left on the board. */
        alive: z.boolean().optional(),
        hp: between.optional(),
        block: between.optional(),
        pos: z.string().min(1).optional(),
        status: ref.optional(),
        stacks: between.optional(),
      })
      .strict(),
    z.object({ kind: z.literal('cards'), zone: z.string().min(1), count: between }).strict(),
    z.object({ kind: z.literal('resource'), resource: id, value: between }).strict(),
  ]);

  // A saved playtest setup (#42): an encounter with a fixed seed and, optionally, a fixed hand and deck order.
  const scenario = z
    .object({
      ...common,
      kind: z.literal('scenario'),
      encounter: ref,
      seed: z.union([z.string().min(1), z.number().int()]),
      /** Drawn first, in order. */
      hand: z.array(ref).optional(),
      /** The rest of the draw pile, top first. With hand or deck set, the deck is not shuffled. */
      deck: z.array(ref).optional(),
      /** Actions to play from the start, every side's, in order (as the debugger records them). */
      actions: z.array(z.object({ type: z.string().min(1), side: z.string().min(1) }).catchall(z.unknown())).optional(),
      /** Checked after the actions: the scenario passes when all hold. */
      expect: z.array(expectation).optional(),
    })
    .strict();

  const item = z.discriminatedUnion('kind', [card, unit, status, tile, encounter, ruleset, scenario]);

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

  return { effect, behavior, card, unit, status, tile, encounter, ruleset, scenario, item, manifest };
}

export type ContentSchemas = ReturnType<typeof createContentSchemas>;
export type ContentKind = 'card' | 'unit' | 'status' | 'tile' | 'encounter' | 'ruleset' | 'scenario';
export const CONTENT_KINDS: readonly ContentKind[] = ['card', 'unit', 'status', 'tile', 'encounter', 'ruleset', 'scenario'];

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
