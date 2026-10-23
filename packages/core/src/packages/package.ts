/**
 * Game packages (decision #14, requirement #5): a manifest, content items and
 * optional code. Packages made in the editor are content only; code packages
 * add rule modules (custom ops are namespaced `packageId:op`), assets and the
 * hooks that build a playable game.
 */
import type { ContentItem, Manifest } from '@ccg/content';
import type { GameRules, GameSetup } from '../kernel/types.js';
import type { RulesModule } from '../rules/compose.js';
import type { ResolvedGame } from './registry.js';

/** Turns a package-relative asset path (e.g. `assets/cards/strike.png`) into a URL. */
export interface AssetResolver {
  url(path: string): string;
}

export interface GamePackage<W = unknown> {
  manifest: Manifest;
  content: ContentItem[];
  /** Source file of each item, keyed `kind:id`, for error messages. */
  paths?: Record<string, string>;
  /** Rule modules contributing custom ops, steps, listeners... Op ids must start with `packageId:`. */
  modules?: RulesModule<W>[];
  assets?: AssetResolver;
  /** For the game being played (not expansions): build its rules from the resolved packages. */
  createRules?(game: ResolvedGame<W>): GameRules<W>;
  /** For the game being played: the starting setup, e.g. for one encounter. */
  createSetup?(game: ResolvedGame<W>, options: { seed: string | number; encounter?: string }): GameSetup<W>;
}

/** `packageId:id` for local references; references that already name a package are unchanged. */
export function qualify(ref: string, packageId: string): string {
  return ref.includes(':') ? ref : `${packageId}:${ref}`;
}

/** Whether a package can be played: it builds its own rules, or has a ruleset for the standard game (decision #87). */
export function isPlayable(pkg: GamePackage<unknown>): boolean {
  return (pkg.createRules !== undefined && pkg.createSetup !== undefined) || pkg.content.some((item) => item.kind === 'ruleset');
}

/** Whether a value looks like a game package (for dynamically imported modules). */
export function isGamePackage(value: unknown): value is GamePackage {
  if (typeof value !== 'object' || value === null) return false;
  const pkg = value as Partial<GamePackage>;
  return typeof pkg.manifest === 'object' && pkg.manifest !== null && Array.isArray(pkg.content);
}
