/**
 * Authoring API for game packages (#25, decision #14). Code-first authors use
 * these helpers; they produce exactly the data the editor writes (#34).
 */
import { FORMAT_VERSION, type ContentItem, type Manifest, type PatternShapeData, type Targeting } from '@ccg/content';
import type { Effect, GamePackage, OpDefinition, RulesModule } from '@ccg/core';

export {
  ENGINE_API_VERSION,
  defineOp,
  type Effect,
  type GamePackage,
  type OpDefinition,
  type ResolvedGame,
  type RulesModule,
} from '@ccg/core';

export interface GameDefinition<W = unknown> extends Omit<GamePackage<W>, 'manifest' | 'content'> {
  manifest: Omit<Manifest, 'formatVersion'>;
  content?: ContentItem[];
  /** Custom ops, keyed `packageId:name`; wrapped into a rule module named after the package. */
  ops?: Record<string, OpDefinition<W>>;
}

/** Declares a game package. Export it as the module's default export. */
export function defineGame<W = unknown>(def: GameDefinition<W>): GamePackage<W> {
  const { ops, content = [], manifest, modules = [], ...rest } = def;
  const all: RulesModule<W>[] = ops ? [{ name: manifest.id, ops }, ...modules] : modules;
  return { ...rest, manifest: { formatVersion: FORMAT_VERSION, ...manifest }, content, modules: all };
}

interface Common {
  name: string;
  tags?: string[];
  extensions?: Record<string, unknown>;
}

export interface CardFields extends Common {
  cost?: Record<string, number>;
  rarity?: 'basic' | 'common' | 'uncommon' | 'rare' | 'special';
  keywords?: string[];
  /** Defaults to no target. */
  targeting?: Targeting;
  effects: Effect[];
  exhausts?: boolean;
  upgrade?: { name?: string; cost?: Record<string, number>; effects?: Effect[] };
  text?: string;
  art?: string;
}

export interface UnitFields extends Common {
  hp: number;
  faction?: string;
  statuses?: { status: string; stacks: number }[];
  art?: string;
}

export interface StatusFields extends Common {
  stacking: 'intensity' | 'duration' | 'none';
  description?: string;
  hooks?: { on: string; timing?: 'when' | 'after'; scope?: 'self' | 'ally' | 'enemy' | 'any'; phase?: string; effects: Effect[] }[];
  modifiers?: { on: 'damageTaken' | 'damageDealt'; add?: number; perStack?: number; multiply?: number }[];
  icon?: string;
}

export interface TileFields extends Common {
  blocking?: boolean;
  onEnter?: Effect[];
  art?: string;
}

export interface EncounterFields extends Common {
  tiles?: Record<string, string>;
  units: { unit: string; side: string; pos: string; facing?: string }[];
  rewards?: { cards?: string[] };
}

const item = (kind: ContentItem['kind'], id: string, fields: object): ContentItem =>
  ({ formatVersion: FORMAT_VERSION, kind, id, ...fields }) as ContentItem;

export const defineCard = (id: string, fields: CardFields): ContentItem =>
  item('card', id, { targeting: { kind: 'none' }, ...fields });
export const defineUnit = (id: string, fields: UnitFields): ContentItem => item('unit', id, fields);
export const defineStatus = (id: string, fields: StatusFields): ContentItem => item('status', id, fields);
export const defineTile = (id: string, fields: TileFields): ContentItem => item('tile', id, fields);
export const defineEncounter = (id: string, fields: EncounterFields): ContentItem => item('encounter', id, fields);

export type { PatternShapeData, Targeting };
