/**
 * The package registry (#25, decision #14): registers game packages, loads
 * them by dynamic import or from files, and resolves a game with its
 * dependencies into ready-to-use definitions.
 *
 * Resolution checks the engine and dependency version ranges, validates every
 * item against the combined op vocabulary (built-ins plus every package's
 * custom ops), qualifies ids and references as `packageId:id`, and checks that
 * every reference points at something in the resolved set.
 */
import {
  OpRegistry,
  createContentSchemas,
  loadPackage,
  toPointer,
  type ContentItem,
  type FileSource,
  type Manifest,
} from '@ccg/content';
import { builtinOps } from '../builtins.js';
import { buildDefinitions, type Definitions } from '../content.js';
import { clonePlain } from '../clone.js';
import { ContentError, isVarRef } from '../kernel/params.js';
import type { Effect, GameRules, GameSetup } from '../kernel/types.js';
import { describeOps, type RulesModule } from '../rules/compose.js';
import { ENGINE_API_VERSION } from '../version.js';
import { isGamePackage, qualify, type GamePackage } from './package.js';
import { satisfies } from './semver.js';

export interface PackageIssue {
  package: string;
  /** Source file, when known. */
  file?: string;
  /** JSON Pointer within the file or item. */
  pointer: string;
  message: string;
}

export interface ResolvedGame<W = unknown> {
  root: Manifest;
  /** Dependencies first, the game itself last. */
  packages: GamePackage<W>[];
  /** Every item, with ids and references qualified as `packageId:id`. */
  items: ContentItem[];
  definitions: Definitions;
  /** Every package's rule modules, in package order. */
  modules: RulesModule<W>[];
  /** Built-in plus package ops, for validation, card text and the editor. */
  ops: OpRegistry;
  /** Display name of a qualified content reference. */
  name(ref: string): string | undefined;
  /** URL for a package-relative asset path. */
  assetUrl(packageId: string, path: string): string;
  createRules(): GameRules<W>;
  createSetup(options: { seed: string | number; encounter?: string }): GameSetup<W>;
}

export type ResolveResult<W> = { ok: true; game: ResolvedGame<W> } | { ok: false; issues: PackageIssue[] };

/** Widgets whose parameter values reference definitions, by content kind. */
const REF_WIDGETS: Record<string, ContentItem['kind']> = { status: 'status', cardDef: 'card', unitDef: 'unit' };

export class PackageRegistry<W = unknown> {
  readonly #packages = new Map<string, GamePackage<W>>();

  register(pkg: GamePackage<W>): void {
    const id = pkg.manifest.id;
    const existing = this.#packages.get(id);
    if (existing && existing !== pkg) {
      throw new ContentError(`package '${id}' is already registered (version ${existing.manifest.version})`);
    }
    this.#packages.set(id, pkg);
  }

  get(id: string): GamePackage<W> | undefined {
    return this.#packages.get(id);
  }

  list(): GamePackage<W>[] {
    return [...this.#packages.values()].sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1));
  }

  /** Imports an ES module (URL or path) whose default export is a game package, and registers it. */
  async import(specifier: string): Promise<GamePackage<W>> {
    // The URL is only known at run time; bundlers must leave this import alone.
    const mod = (await import(/* @vite-ignore */ specifier)) as { default?: unknown };
    if (!isGamePackage(mod.default)) {
      throw new ContentError(`'${specifier}' does not default-export a game package`);
    }
    const pkg = mod.default as GamePackage<W>;
    this.register(pkg);
    return pkg;
  }

  /**
   * Loads a content-only package from files (game.json + content/**), e.g. one
   * made in the editor, and registers it. Ops from already-registered packages
   * are available to its content.
   */
  async loadFiles(source: FileSource): Promise<{ ok: true; package: GamePackage<W> } | { ok: false; issues: PackageIssue[] }> {
    const ops = builtinOps();
    for (const pkg of this.#packages.values()) describeOps(pkg.modules ?? [], ops);
    const loaded = await loadPackage(source, createContentSchemas(ops));
    const id = loaded.manifest?.id ?? '(unknown)';
    if (!loaded.manifest || loaded.issues.length > 0) {
      return { ok: false, issues: loaded.issues.map((i) => ({ package: id, ...i })) };
    }
    const pkg: GamePackage<W> = {
      manifest: loaded.manifest,
      content: loaded.items.map((i) => i.item),
      paths: Object.fromEntries(loaded.items.map((i) => [`${i.item.kind}:${i.item.id}`, i.path])),
    };
    this.register(pkg);
    return { ok: true, package: pkg };
  }

  resolve(rootId: string): ResolveResult<W> {
    const issues: PackageIssue[] = [];
    const order = this.#order(rootId, issues);
    if (issues.length > 0) return { ok: false, issues };

    const manifestSchema = createContentSchemas(new OpRegistry()).manifest;
    for (const pkg of order) {
      const id = pkg.manifest.id;
      const checked = manifestSchema.safeParse(pkg.manifest);
      if (!checked.success) {
        for (const i of checked.error.issues) issues.push({ package: id, file: 'game.json', pointer: toPointer(i.path), message: i.message });
        continue;
      }
      if (!satisfies(ENGINE_API_VERSION, pkg.manifest.engine)) {
        issues.push({
          package: id,
          file: 'game.json',
          pointer: '/engine',
          message: `needs engine API ${pkg.manifest.engine}, but this engine is ${ENGINE_API_VERSION}`,
        });
      }
    }

    const ops = builtinOps();
    for (const pkg of order) {
      const id = pkg.manifest.id;
      for (const module of pkg.modules ?? []) {
        for (const opId of Object.keys(module.ops ?? {})) {
          if (!opId.startsWith(`${id}:`)) {
            issues.push({ package: id, pointer: '', message: `op '${opId}' must be namespaced as '${id}:…'` });
          }
        }
        try {
          describeOps([module], ops);
        } catch (error) {
          issues.push({ package: id, pointer: '', message: (error as Error).message });
        }
      }
    }
    if (issues.length > 0) return { ok: false, issues };

    const schemas = createContentSchemas(ops);
    const items: ContentItem[] = [];
    const refs: { package: string; file: string; pointer: string; kind: ContentItem['kind']; ref: string }[] = [];
    for (const pkg of order) {
      const id = pkg.manifest.id;
      const seen = new Set<string>();
      for (const item of pkg.content) {
        const key = `${item.kind}:${item.id}`;
        const file = pkg.paths?.[key] ?? `${item.kind}/${item.id}`;
        if (seen.has(key)) {
          issues.push({ package: id, file, pointer: '/id', message: `duplicate ${item.kind} id '${item.id}'` });
          continue;
        }
        seen.add(key);
        const checked = schemas.item.safeParse(item);
        if (!checked.success) {
          for (const i of checked.error.issues) issues.push({ package: id, file, pointer: toPointer(i.path), message: i.message });
          continue;
        }
        const qualified = qualifyItem(clonePlain(item), id, ops, (kind, ref, pointer) =>
          refs.push({ package: id, file, pointer, kind, ref }),
        );
        items.push(qualified);
      }
    }

    const known = new Set(items.map((i) => `${i.kind}:${i.id}`));
    for (const r of refs) {
      if (!known.has(`${r.kind}:${r.ref}`)) {
        issues.push({ package: r.package, file: r.file, pointer: r.pointer, message: `unknown ${r.kind} '${r.ref}'` });
      }
    }
    if (issues.length > 0) return { ok: false, issues };

    const root = order.at(-1) as GamePackage<W>;
    const names = new Map(items.map((i) => [i.id, i.name]));
    const game: ResolvedGame<W> = {
      root: root.manifest,
      packages: order,
      items,
      definitions: buildDefinitions(items),
      modules: order.flatMap((p) => p.modules ?? []),
      ops,
      name: (ref) => names.get(ref),
      assetUrl: (packageId, path) => this.#packages.get(packageId)?.assets?.url(path) ?? path,
      createRules: () => {
        if (!root.createRules) throw new ContentError(`package '${root.manifest.id}' does not define createRules`);
        return root.createRules(game);
      },
      createSetup: (options) => {
        if (!root.createSetup) throw new ContentError(`package '${root.manifest.id}' does not define createSetup`);
        return root.createSetup(game, options);
      },
    };
    return { ok: true, game };
  }

  /** The dependency closure of a package, dependencies first. */
  #order(rootId: string, issues: PackageIssue[]): GamePackage<W>[] {
    const out: GamePackage<W>[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string, from: string | null, range: string | null) => {
      const pkg = this.#packages.get(id);
      if (!pkg) {
        issues.push({ package: from ?? id, file: 'game.json', pointer: from ? `/depends/${id}` : '', message: `package '${id}' is not registered` });
        return;
      }
      if (range !== null && !satisfies(pkg.manifest.version, range)) {
        issues.push({
          package: from as string,
          file: 'game.json',
          pointer: `/depends/${id}`,
          message: `needs ${id} ${range}, but ${pkg.manifest.version} is registered`,
        });
      }
      if (state.get(id) === 'done') return;
      if (state.get(id) === 'visiting') {
        issues.push({ package: id, file: 'game.json', pointer: '/depends', message: `dependency cycle through '${id}'` });
        return;
      }
      state.set(id, 'visiting');
      for (const [dep, depRange] of Object.entries(pkg.manifest.depends ?? {}).sort()) visit(dep, id, depRange);
      state.set(id, 'done');
      out.push(pkg);
    };
    visit(rootId, null, null);
    return out;
  }
}

type RefSink = (kind: ContentItem['kind'], ref: string, pointer: string) => void;

/** Qualifies an item's id and every reference in it, reporting each reference. */
function qualifyItem(item: ContentItem, pkg: string, ops: OpRegistry, sink: RefSink): ContentItem {
  const ref = (kind: ContentItem['kind'], value: string, pointer: string) => {
    const q = qualify(value, pkg);
    sink(kind, q, pointer);
    return q;
  };
  const effects = (list: unknown, pointer: string) => {
    if (Array.isArray(list)) list.forEach((e, i) => qualifyEffect(e as Effect, `${pointer}/${i}`));
  };
  const qualifyEffect = (effect: Effect, pointer: string) => {
    const meta = ops.get(effect.op);
    for (const [key, widget] of Object.entries(meta?.widgets ?? {})) {
      const value = effect[key];
      if (value === undefined || isVarRef(value)) continue;
      const kind = REF_WIDGETS[widget];
      if (kind && typeof value === 'string') effect[key] = ref(kind, value, `${pointer}/${key}`);
      else if (widget === 'effects') effects(value, `${pointer}/${key}`);
    }
  };

  item.id = qualify(item.id, pkg);
  const f = item as Record<string, unknown> & ContentItem;
  switch (item.kind) {
    case 'card': {
      effects(f.effects, '/effects');
      effects((f.upgrade as { effects?: unknown } | undefined)?.effects, '/upgrade/effects');
      const keywords = f.keywords as string[] | undefined;
      if (keywords) f.keywords = keywords.map((k, i) => ref('status', k, `/keywords/${i}`));
      const permanent = f.permanent as { unit?: string; abilities?: { effects: unknown }[] } | undefined;
      if (permanent?.unit) permanent.unit = ref('unit', permanent.unit, '/permanent/unit');
      permanent?.abilities?.forEach((a, i) => effects(a.effects, `/permanent/abilities/${i}/effects`));
      break;
    }
    case 'unit': {
      for (const [i, s] of ((f.statuses as { status: string }[] | undefined) ?? []).entries()) {
        s.status = ref('status', s.status, `/statuses/${i}/status`);
      }
      // Behaviour trees hold intents, whose effects reference content too.
      const walk = (node: unknown, pointer: string): void => {
        if (typeof node !== 'object' || node === null) return;
        const n = node as Record<string, unknown>;
        if (n.kind === 'intent') effects((n.intent as { effects?: unknown }).effects, `${pointer}/intent/effects`);
        if (Array.isArray(n.steps)) n.steps.forEach((step, i) => walk(step, `${pointer}/steps/${i}`));
        if (Array.isArray(n.options)) n.options.forEach((o, i) => walk((o as { then: unknown }).then, `${pointer}/options/${i}/then`));
        if (n.kind === 'if') {
          walk(n.then, `${pointer}/then`);
          walk(n.else, `${pointer}/else`);
        }
      };
      walk(f.behavior, '/behavior');
      break;
    }
    case 'status':
      for (const [i, hook] of ((f.hooks as { effects: unknown }[] | undefined) ?? []).entries()) effects(hook.effects, `/hooks/${i}/effects`);
      break;
    case 'tile':
      effects(f.onEnter, '/onEnter');
      break;
    case 'encounter': {
      for (const [i, u] of (f.units as { unit: string }[]).entries()) u.unit = ref('unit', u.unit, `/units/${i}/unit`);
      const tiles = f.tiles as Record<string, string> | undefined;
      if (tiles) for (const pos of Object.keys(tiles)) tiles[pos] = ref('tile', tiles[pos] as string, `/tiles/${pos}`);
      const rewards = f.rewards as { cards?: string[] } | undefined;
      if (rewards?.cards) rewards.cards = rewards.cards.map((c, i) => ref('card', c, `/rewards/cards/${i}`));
      break;
    }
  }
  return item;
}
