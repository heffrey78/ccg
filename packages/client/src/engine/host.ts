/**
 * The engine host: owns the package registry and the running session, plays
 * AI sides, and answers the UI with projected views only. It is pure
 * TypeScript, so it runs in a Web Worker, in Tauri, or in-process in tests.
 */
import {
  PackageRegistry,
  Session,
  decidingSide,
  effectsText,
  isPlayable,
  legalActions,
  randomPolicy,
  redactEvents,
  viewState,
  type DeclaredIntent,
  type GameEvent,
  type GamePackage,
  type GameRules,
  type ResolvedGame,
  type SetupOptions,
  type SideId,
  type StatePolicy,
} from '@ccg/core';
import { filesSource, unzipFiles } from '@ccg/content';
import { cardFace } from './faces.js';
import type { Catalog, EngineReply, EngineRequest, GameListing, IntentSummary, Snapshot } from './protocol.js';

export interface HostOptions {
  /** Packages bundled with the app. */
  packages?: GamePackage<unknown>[];
  /** ES module URLs of packages to import at startup. */
  urls?: string[];
  /** Policy for AI-controlled sides. Default: random, seeded per game. */
  ai?: (game: GameListing) => StatePolicy<unknown>;
  /** Stop an AI that keeps acting without handing the decision back. */
  maxAiActions?: number;
}

export interface EngineHost {
  handle(request: EngineRequest): Promise<EngineReply>;
}

interface Running {
  game: GameListing;
  rules: GameRules<unknown>;
  session: Session<unknown>;
  side: SideId;
  /** How the game was started, to rebuild it after content changes. */
  options: SetupOptions;
  catalog: Catalog;
  resolved: ResolvedGame<unknown>;
  topology?: string;
  ai: StatePolicy<unknown>;
}

function catalogOf(game: ResolvedGame<unknown>, topology: string | undefined): Catalog {
  const name = (ref: string) => game.name(ref);
  const catalog: Catalog = { names: {}, cards: {}, statuses: {} };
  for (const item of game.items) {
    catalog.names[item.id] = item.name;
    if (item.kind === 'card') {
      catalog.cards[item.id] = cardFace(item, game.ops, {
        ...(topology && { topology }),
        name,
        art: (path) => game.assetUrl(item.id.split(':')[0] as string, path),
      });
    } else if (item.kind === 'status') {
      catalog.statuses[item.id] = {
        name: item.name,
        stacking: String(item.stacking),
        ...(typeof item.description === 'string' && { description: item.description }),
      };
    }
  }
  return catalog;
}

/** Text and damage for the intents a viewer can see (hidden ones have no effects in the view). */
function intentSummaries(game: Running, declared: Partial<DeclaredIntent>[]): Record<string, IntentSummary> {
  const out: Record<string, IntentSummary> = {};
  for (const intent of declared) {
    if (!intent.id || !intent.effects) continue;
    const damages = intent.effects.filter((e) => e.op === 'damage').map((e) => e.amount);
    out[intent.id] = {
      text: effectsText(intent.effects, game.resolved.ops, { ...(game.topology && { topology: game.topology }), name: (r) => game.resolved.name(r) }),
      ...(damages.length > 0 && damages.every((d) => typeof d === 'number') && { damage: (damages as number[]).reduce((a, b) => a + b, 0) }),
    };
  }
  return out;
}

export function createEngineHost(options: HostOptions = {}): EngineHost {
  const registry = new PackageRegistry<unknown>();
  for (const pkg of options.packages ?? []) registry.register(pkg);
  let loading: Promise<void> | null = (async () => {
    for (const url of options.urls ?? []) await registry.import(url);
  })();
  let running: Running | null = null;

  const listing = (pkg: GamePackage<unknown>): GameListing => ({
    id: pkg.manifest.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    ...(pkg.manifest.description && { description: pkg.manifest.description }),
  });

  /** Lets AI sides act until the decision is the UI side's again (or nobody's). */
  const runAi = (game: Running): GameEvent[] => {
    const events: GameEvent[] = [];
    for (let i = 0; i < (options.maxAiActions ?? 500); i++) {
      const side = decidingSide(game.rules, game.session.state);
      if (side === null || side === game.side) break;
      const actions = legalActions(game.rules, game.session.state, side);
      if (actions.length === 0) break;
      const result = game.session.apply(game.ai.choose(game.rules, game.session.state, side, actions));
      if (!result.ok) throw new Error(`AI action failed: ${result.error.message}`);
      events.push(...result.events);
    }
    return events;
  };

  const snapshot = (game: Running, events: GameEvent[]): Snapshot => {
    const state = game.session.state;
    const deciding = decidingSide(game.rules, state);
    const view = viewState(game.rules, state, game.side);
    const declared = (view.world as { intents?: { declared: Partial<DeclaredIntent>[] } }).intents?.declared ?? [];
    return {
      game: game.game,
      side: game.side,
      view,
      events: redactEvents(game.rules, events, game.side, state),
      deciding,
      legal: deciding === game.side ? legalActions(game.rules, state, game.side) : [],
      catalog: game.catalog,
      presentation: game.rules.presentation ?? {},
      intents: intentSummaries(game, declared),
    };
  };

  const playable = () => registry.list().filter(isPlayable).map(listing);
  const aiFor = (game: GameListing, seed: string | number) => options.ai?.(game) ?? randomPolicy(`ai:${String(seed)}`);
  const issuesText = (issues: { package?: string; file?: string; pointer: string; message: string }[]) =>
    issues.map((i) => `${i.package ? `${i.package} ` : ''}${i.file ?? ''}${i.pointer}: ${i.message}`).join('\n');

  /** Registers a package from its files (replacing one with the same id); assets become object URLs. */
  const load = async (files: Record<string, Uint8Array>): Promise<{ id: string } | { error: EngineReply }> => {
    const urls: Record<string, string> = {};
    for (const [path, data] of Object.entries(files)) {
      if (path.startsWith('assets/') && typeof URL.createObjectURL === 'function') urls[path] = URL.createObjectURL(new Blob([data as BlobPart]));
    }
    const loaded = await registry.loadFiles(filesSource(files), { replace: true, assets: { url: (path) => urls[path] ?? path } });
    if (!loaded.ok) return { error: { ok: false, error: { code: 'invalid-package', message: issuesText(loaded.issues) } } };
    return { id: loaded.package.manifest.id };
  };

  /** Resolves a game and builds its rules and setup. */
  const build = (game: GameListing, setupOptions: SetupOptions) => {
    const resolved = registry.resolve(game.id);
    if (!resolved.ok) return { error: { ok: false, error: { code: 'invalid-package', message: issuesText(resolved.issues) } } as EngineReply };
    try {
      const rules = resolved.game.createRules();
      const setup = resolved.game.createSetup(setupOptions);
      const topology = (rules.presentation?.board as { kind?: string } | undefined)?.kind;
      return {
        rules,
        setup,
        versions: Object.fromEntries(resolved.game.packages.map((p) => [p.manifest.id, p.manifest.version])),
        parts: { game, rules, catalog: catalogOf(resolved.game, topology), resolved: resolved.game, ...(topology && { topology }) },
      };
    } catch (e) {
      return { error: { ok: false, error: { code: 'invalid-package', message: (e as Error).message } } as EngineReply };
    }
  };

  /**
   * Applies new content to the running game (#42). `hot` keeps the current
   * state and uses the new rules from the next action; `replay` restarts with
   * the same setup options and replays the action log, stopping at the first
   * action that is no longer legal.
   */
  const rebuild = (game: Running, mode: 'hot' | 'replay'): EngineReply => {
    const built = build(game.game, game.options);
    if ('error' in built) return built.error;
    if (mode === 'hot') {
      running = { ...game, ...built.parts, session: game.session.rebind(built.rules) };
      return { ok: true, type: 'snapshot', snapshot: { ...snapshot(running, []), notice: 'Changes applied: the game continues with them.' } };
    }
    const started = Session.start(built.rules, built.setup, built.versions);
    if (!started.ok) return { ok: false, error: started.error };
    const actions = game.session.log.actions;
    let replayed = 0;
    let failure: string | null = null;
    for (const action of actions) {
      const result = started.session.apply(action);
      if (!result.ok) {
        failure = result.error.message;
        break;
      }
      replayed++;
    }
    running = { ...game, ...built.parts, session: started.session };
    const events = runAi(running);
    const notice =
      failure === null
        ? `Changes applied: replayed all ${actions.length} actions.`
        : `Replayed ${replayed} of ${actions.length} actions; action ${replayed + 1} is no longer legal (${failure}).`;
    return { ok: true, type: 'snapshot', snapshot: { ...snapshot(running, events), notice } };
  };

  return {
    async handle(request) {
      if (loading) {
        await loading;
        loading = null;
      }
      switch (request.type) {
        case 'listGames':
          return { ok: true, type: 'games', games: registry.list().filter(isPlayable).map(listing) };

        case 'importZip': {
          let files: Record<string, Uint8Array>;
          try {
            files = unzipFiles(request.data);
          } catch (e) {
            return { ok: false, error: { code: 'invalid-package', message: `not a zip file: ${(e as Error).message}` } };
          }
          const loaded = await load(files);
          return 'error' in loaded ? loaded.error : { ok: true, type: 'games', games: playable(), loaded: loaded.id };
        }

        case 'loadFiles': {
          const loaded = await load(request.files);
          return 'error' in loaded ? loaded.error : { ok: true, type: 'games', games: playable(), loaded: loaded.id };
        }

        case 'reload': {
          if (!running) return { ok: false, error: { code: 'not-started', message: 'no game is running' } };
          const loaded = await load(request.files);
          if ('error' in loaded) return loaded.error;
          if (loaded.id !== running.game.id) return { ok: false, error: { code: 'unknown-game', message: `the running game is '${running.game.id}', not '${loaded.id}'` } };
          return rebuild(running, request.mode);
        }

        case 'start': {
          const pkg = registry.get(request.game);
          if (!pkg) return { ok: false, error: { code: 'unknown-game', message: `no game '${request.game}'` } };
          const options: SetupOptions = {
            seed: request.seed,
            ...(request.encounter && { encounter: request.encounter }),
            ...(request.scenario && { scenario: request.scenario }),
            ...(request.hand && { hand: request.hand }),
          };
          const built = build(listing(pkg), options);
          if ('error' in built) return built.error;
          const started = Session.start(built.rules, built.setup, built.versions);
          if (!started.ok) return { ok: false, error: started.error };
          const side = built.setup.sides.find((s) => s.controller === 'human')?.id ?? (built.setup.sides[0]?.id as SideId);
          running = { ...built.parts, session: started.session, side, options, ai: aiFor(built.parts.game, request.seed) };
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, runAi(running)) };
        }

        case 'act': {
          if (!running) return { ok: false, error: { code: 'not-started', message: 'no game is running' } };
          if (request.action.side !== running.side) {
            return { ok: false, error: { code: 'illegal-action', message: `the UI plays side '${running.side}'` } };
          }
          const result = running.session.apply(request.action);
          if (!result.ok) return { ok: false, error: result.error };
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, [...result.events, ...runAi(running)]) };
        }

        case 'view':
          if (!running) return { ok: false, error: { code: 'not-started', message: 'no game is running' } };
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, []) };
      }
    },
  };
}
