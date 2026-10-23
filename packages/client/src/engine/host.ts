/**
 * The engine host: owns the package registry and the running session, plays
 * AI sides, and answers the UI with projected views only. It is pure
 * TypeScript, so it runs in a Web Worker, in Tauri, or in-process in tests.
 */
import {
  PackageRegistry,
  Session,
  cardText,
  decidingSide,
  effectsText,
  legalActions,
  randomPolicy,
  redactEvents,
  targetingText,
  viewState,
  type CardDef,
  type DeclaredIntent,
  type Effect,
  type GameEvent,
  type GamePackage,
  type GameRules,
  type ResolvedGame,
  type SideId,
  type StatePolicy,
} from '@ccg/core';
import type { CardFace, Catalog, EngineReply, EngineRequest, GameListing, IntentSummary, Snapshot } from './protocol.js';

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
      const def = game.definitions.cards[item.id] as CardDef;
      const abilities: Record<string, string> = {};
      def.permanent?.abilities?.forEach((a, i) => {
        if (a.kind === 'activated') abilities[i] = a.name;
      });
      const face: CardFace = {
        name: item.name,
        text: cardText(item as unknown as { text?: string; effects: Effect[] }, game.ops, { ...(topology && { topology }), name }),
        targeting: targetingText(def.targeting, topology ? { topology } : {}),
        cost: def.cost ?? {},
        timing: def.timing ?? 'main',
        keywords: ((item.keywords as string[] | undefined) ?? []).map((k) => game.name(k) ?? k),
        abilities,
      };
      if (typeof item.art === 'string') face.art = game.assetUrl(item.id.split(':')[0] as string, item.art);
      catalog.cards[item.id] = face;
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
          const topology = (rules.presentation?.board as { kind?: string } | undefined)?.kind;
          running = {
            game,
            rules,
            session: started.session,
            side,
            catalog: catalogOf(resolved.game, topology),
            resolved: resolved.game,
            ...(topology && { topology }),
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
