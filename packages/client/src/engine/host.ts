/**
 * The engine host: owns the package registry and the running session, plays
 * AI sides, and answers the UI with projected views only. It is pure
 * TypeScript, so it runs in a Web Worker, in Tauri, or in-process in tests.
 */
import {
  PackageRegistry,
  Session,
  decidingSide,
  legalActions,
  randomPolicy,
  redactEvents,
  viewState,
  type GameEvent,
  type GamePackage,
  type GameRules,
  type SideId,
  type StatePolicy,
} from '@ccg/core';
import type { EngineReply, EngineRequest, GameListing, Snapshot } from './protocol.js';

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
  names: Record<string, string>;
  ai: StatePolicy<unknown>;
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
    return {
      game: game.game,
      side: game.side,
      view: viewState(game.rules, state, game.side),
      events: redactEvents(game.rules, events, game.side, state),
      deciding,
      legal: deciding === game.side ? legalActions(game.rules, state, game.side) : [],
      names: game.names,
    };
  };

  return {
    async handle(request) {
      if (loading) {
        await loading;
        loading = null;
      }
      switch (request.type) {
        case 'listGames':
          return { ok: true, type: 'games', games: registry.list().filter((p) => p.createRules && p.createSetup).map(listing) };

        case 'start': {
          const pkg = registry.get(request.game);
          if (!pkg) return { ok: false, error: { code: 'unknown-game', message: `no game '${request.game}'` } };
          const resolved = registry.resolve(request.game);
          if (!resolved.ok) {
            return { ok: false, error: { code: 'invalid-package', message: resolved.issues.map((i) => `${i.package} ${i.file ?? ''}${i.pointer}: ${i.message}`).join('\n') } };
          }
          const rules = resolved.game.createRules();
          const setup = resolved.game.createSetup({ seed: request.seed, ...(request.encounter && { encounter: request.encounter }) });
          const started = Session.start(rules, setup, Object.fromEntries(resolved.game.packages.map((p) => [p.manifest.id, p.manifest.version])));
          if (!started.ok) return { ok: false, error: started.error };
          const side = setup.sides.find((s) => s.controller === 'human')?.id ?? (setup.sides[0]?.id as SideId);
          const game = listing(pkg);
          running = {
            game,
            rules,
            session: started.session,
            side,
            names: Object.fromEntries(resolved.game.items.map((i) => [i.id, i.name])),
            ai: options.ai?.(game) ?? randomPolicy(`ai:${String(request.seed)}`),
          };
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
