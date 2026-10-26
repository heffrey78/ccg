/**
 * The engine host: owns the package registry and the running session, plays
 * AI sides, and answers the UI with projected views only. It is pure
 * TypeScript, so it runs in a Web Worker, in Tauri, or in-process in tests.
 */
import {
  PackageRegistry,
  Session,
  apply,
  createGame,
  decidingSide,
  effectsText,
  isPlayable,
  legalActions,
  randomPolicy,
  redactEvents,
  COMBAT_NODES,
  difficultyOf,
  difficultyScale,
  fruitingOffer,
  junctionOffer,
  rulesetOf,
  scaledHp,
  startingStrains,
  strainsOf,
  runMapDepths,
  runMapIssues,
  runMapOf,
  runRewards,
  standardInput,
  type RunCard,
  type RunMap,
  type RunNode,
  type RunNodeKind,
  viewState,
  type Action,
  type DeclaredIntent,
  type GameEvent,
  type GamePackage,
  type GameRules,
  type GameState,
  type ResolvedGame,
  type RulesetDef,
  type SetupOptions,
  type SideId,
  type StatePolicy,
} from '@ccg/core';
import { filesSource, unzipFiles, type ContentItem } from '@ccg/content';
import { cardFace } from './faces.js';
import { frameFor, resolveTheme } from './theme.js';
import type { RunProgress } from './protocol.js';
import type { Catalog, EngineReply, EngineRequest, GameListing, IntentSummary, Snapshot } from './protocol.js';

export interface HostOptions {
  /** Packages bundled with the app. */
  packages?: GamePackage<unknown>[];
  /** ES module URLs of packages to import at startup. */
  urls?: string[];
  /** Content-only packages to load at startup, as their files (e.g. bundled examples); may still be arriving. */
  files?: (Record<string, Uint8Array> | Promise<Record<string, Uint8Array>>)[];
  /** Policy for AI-controlled sides. Default: random, seeded per game. */
  ai?: (game: GameListing) => StatePolicy<unknown>;
  /** Stop an AI that keeps acting without handing the decision back. */
  maxAiActions?: number;
  /** Allow `debug` and `branch` requests, which reveal everything (#46). For editors' playtests, never for players. */
  debug?: boolean;
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
  /** Set when playing a run (#45): its encounters in order, with rewards between them. */
  run?: RunState;
  /** Undo can't take back actions before this many (#83). */
  undoFloor?: number;
}

interface RunState {
  /** The run as a graph (#100), with qualified encounter ids; a linear run is a chain. */
  map: RunMap;
  /** Whether the ruleset drew a map, so the client shows it. */
  branching: boolean;
  /** The node being played (or just finished). */
  node: string;
  /** Nodes entered so far, in order. */
  visited: string[];
  deck: RunCard[];
  hp: Record<string, number>;
  seed: string | number;
  carryHp: boolean;
  /** The difficulty level's id (#125), kept for every encounter of the run. */
  difficulty?: string;
  status: 'playing' | 'reward' | 'map' | 'service' | 'won' | 'lost';
  /** At a spring or fruiting log: what it offers (#103). */
  service?: { kind: 'spring' | 'fruiting'; offer: string[] };
  rewards?: string[];
  /** Nodes the player may go to next, when `status` is `map`. */
  choices?: string[];
  /** Strains connected so far (#101). */
  unlocked: string[];
  /** What the offered rewards are: cards for the deck, or strains to connect at a junction. */
  offer?: 'card' | 'strain';
}

const NODE_NAMES: Record<RunNodeKind, string> = { fight: 'Fight', elite: 'Elite fight', boss: 'Boss', junction: 'Junction', spring: 'Spring', fruiting: 'Fruiting log' };

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
/** A file's type from its extension, so object URLs of SVGs render as images. */
const mimeOf = (path: string) => MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

function catalogOf(game: ResolvedGame<unknown>, topology: string | undefined): Catalog {
  const name = (ref: string) => game.name(ref);
  const catalog: Catalog = { names: {}, cards: {}, statuses: {}, art: {} };
  // The game's own theme (#135): the root package's first.
  const themeItem = game.items.find((i) => i.kind === 'theme' && i.id.startsWith(`${game.root.id}:`));
  if (themeItem) catalog.theme = resolveTheme(themeItem, (path) => game.assetUrl(game.root.id, path));
  for (const item of game.items) {
    catalog.names[item.id] = item.name;
    const art = item.art ?? item.icon;
    if (typeof art === 'string' && item.kind !== 'card') catalog.art[item.id] = game.assetUrl(item.id.split(':')[0] as string, art);
    if (item.kind === 'card') {
      catalog.cards[item.id] = cardFace(item, game.ops, {
        ...(topology && { topology }),
        name,
        art: (path) => game.assetUrl(item.id.split(':')[0] as string, path),
        ...(themeItem && { frame: (card: ContentItem) => frameFor(themeItem, card) }),
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

/** The current encounter's scene for a snapshot: its background, or the ruleset's. */
function scene(game: Running): { scene?: { background: string } } {
  const items = game.resolved.items;
  const prefix = `${game.resolved.root.id}:`;
  const scenario = game.options.scenario ? items.find((i) => i.id === game.options.scenario) : undefined;
  const encounterId = (scenario?.encounter as string | undefined) ?? game.options.encounter ?? items.find((i) => i.kind === 'encounter' && i.id.startsWith(prefix))?.id;
  const encounter = items.find((i) => i.kind === 'encounter' && i.id === encounterId);
  const ruleset = items.find((i) => i.kind === 'ruleset' && i.id.startsWith(prefix));
  const background = (encounter?.background ?? ruleset?.background) as string | undefined;
  return background ? { scene: { background: game.resolved.assetUrl(game.resolved.root.id, background) } } : {};
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
  // Set below, once the loaders it uses exist.
  let loading: Promise<void> | null = null;
  let running: Running | null = null;

  const listing = (pkg: GamePackage<unknown>): GameListing => {
    const difficulty = (pkg.content.find((i) => i.kind === 'ruleset') as Partial<RulesetDef> | undefined)?.difficulty;
    return {
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      ...(pkg.manifest.description && { description: pkg.manifest.description }),
      ...(difficulty && {
        difficulties: difficulty.levels.map((l) => ({ id: l.id, name: l.name, ...(l.description && { description: l.description }) })),
        ...(difficulty.default && { defaultDifficulty: difficulty.default }),
      }),
    };
  };

  /** The level a game is played at, if its ruleset has levels. */
  const levelOf = (game: Running) => safely(() => difficultyOf(rulesetOf(game.resolved), game.options.difficulty)) ?? undefined;

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
    const level = levelOf(game);
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
      ...scene(game),
      ...(level && { difficulty: level.name }),
      canUndo: game.rules.undo === 'turn' && !state.outcome && game.session.log.actions.length > (game.undoFloor ?? 0),
      ...(game.run && { run: runProgress(game, game.run) }),
    };
  };

  /** What the human side knows: the card identities and units its view shows. */
  const knowledge = (game: Running, state: GameState<unknown>): Set<string> => {
    const world = viewState(game.rules, state, game.side).world as { cards?: { instances: Record<string, { def: string }> }; board?: { units: Record<string, unknown> } };
    return new Set([
      ...Object.entries(world.cards?.instances ?? {}).map(([id, c]) => `card:${id}:${c.def}`),
      ...Object.keys(world.board?.units ?? {}).map((id) => `unit:${id}`),
    ]);
  };

  /** Whether the player's action can be taken back: their own move, no chance, nothing new seen. */
  const takeBackable = (game: Running, before: GameState<unknown>, action: Action): boolean => {
    if (game.rules.undo !== 'turn' || action.type === 'endTurn' || action.type === 'pass') return false;
    const after = game.session.state;
    if (JSON.stringify(after.rng) !== JSON.stringify(before.rng)) return false;
    const known = knowledge(game, before);
    return [...knowledge(game, after)].every((k) => known.has(k));
  };

  /** What the client sees of a run: its progress and, for a branching run, the map. */
  const runProgress = (game: Running, run: RunState): RunProgress => {
    const depths = runMapDepths(run.map);
    const total = Math.max(...depths.values()) + 1;
    const nodeName = (n: RunNode) => (n.encounter ? (game.catalog.names[n.encounter] ?? n.encounter) : NODE_NAMES[n.kind]);
    return {
      stage: run.visited.length,
      total,
      status: run.status,
      ...(run.rewards && run.status === 'reward' && { rewards: run.rewards, offer: run.offer ?? 'card' }),
      ...(run.service && run.status === 'service' && { service: run.service }),
      deck: run.deck,
      ...((rulesetOf(game.resolved).run?.strains ?? []).length > 0 && { strains: { all: rulesetOf(game.resolved).run?.strains ?? [], unlocked: run.unlocked } }),
      ...(run.branching && {
        map: {
          nodes: run.map.nodes.map((n) => ({ id: n.id, kind: n.kind, name: nodeName(n), depth: depths.get(n.id) ?? 0, next: n.next })),
          visited: run.visited,
          current: run.node,
          choices: run.status === 'map' ? (run.choices ?? []) : [],
        },
      }),
    };
  };

  /** After an action in a run: on a win, offer rewards (or finish); on a loss, end the run. */
  const advanceRun = (game: Running): void => {
    const run = game.run;
    const outcome = game.session.state.outcome;
    if (!run || run.status !== 'playing' || !outcome) return;
    if (!outcome.winners.includes(game.side)) {
      run.status = 'lost';
      return;
    }
    if (run.carryHp) {
      const units = Object.values((game.session.state.world as { board?: { units: Record<string, { def: string; side: string; hp: number }> } }).board?.units ?? {});
      for (const u of units) if (u.side === game.side) run.hp[u.def] = u.hp;
    }
    const node = run.map.nodes.find((n) => n.id === run.node);
    if (!node || node.kind === 'boss' || node.next.length === 0) {
      run.status = 'won';
      return;
    }
    run.status = 'reward';
    run.offer = 'card';
    run.rewards = runRewards(rulesetOf(game.resolved), standardInput(game.resolved), node.encounter as string, run.seed, run.visited.length - 1, { unlocked: run.unlocked, deck: run.deck.map((c) => c.def) });
  };

  /** Moves the run on after a reward or a non-combat node: straight on if there's one way, else to the map. */
  const onward = (game: Running, run: RunState, notice?: string): EngineReply => {
    const node = run.map.nodes.find((n) => n.id === run.node);
    const next = node?.next ?? [];
    if (next.length === 0) {
      running = { ...game, run: { ...run, status: 'won' } };
      return { ok: true, type: 'snapshot', snapshot: { ...snapshot(running, []), ...(notice && { notice }) } };
    }
    if (next.length === 1 && !run.branching) return enter(game.game, run, next[0] as string);
    running = { ...game, run: { ...run, status: 'map', choices: next } };
    return { ok: true, type: 'snapshot', snapshot: { ...snapshot(running, []), ...(notice && { notice }) } };
  };

  /** Enters a run node: fights start an encounter; a spring heals; other nodes pass on for now. */
  const enter = (game: GameListing, previous: RunState, id: string): EngineReply => {
    const node = previous.map.nodes.find((n) => n.id === id);
    if (!node) return { ok: false, error: { code: 'illegal-action', message: `there is no node '${id}'` } };
    const { rewards: _r, choices: _c, offer: _o, service: _s, ...kept } = previous;
    const run: RunState = { ...kept, node: id, visited: [...previous.visited, id], status: 'playing' };
    if (!COMBAT_NODES.has(node.kind)) {
      if (!running) return { ok: false, error: { code: 'not-started', message: 'a run must start with a fight' } };
      let notice = `${NODE_NAMES[node.kind]}: nothing happens here.`;
      if (node.kind === 'spring' || node.kind === 'fruiting') {
        // A spring heals or thins the deck; a fruiting log cross-breeds a hybrid or upgrades a card.
        const offer =
          node.kind === 'fruiting' ? fruitingOffer(rulesetOf(running.resolved), standardInput(running.resolved), { unlocked: run.unlocked, deck: run.deck.map((c) => c.def) }, run.seed, run.visited.length - 1) : [];
        running = { ...running, run: { ...run, status: 'service', service: { kind: node.kind, offer } } };
        return { ok: true, type: 'snapshot', snapshot: snapshot(running, []) };
      }
      if (node.kind === 'junction') {
        // Another mycelium reaches out: one card from each of up to three unconnected strains.
        const offer = junctionOffer(rulesetOf(running.resolved), standardInput(running.resolved), run.unlocked, run.seed, run.visited.length - 1);
        if (offer.length > 0) {
          running = { ...running, run: { ...run, status: 'reward', offer: 'strain', rewards: offer } };
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, []) };
        }
        notice = 'Junction: there are no more strains to connect with.';
      }
      return onward(running, run, notice);
    }
    const setupOptions: SetupOptions = {
      seed: `${String(run.seed)}:${run.visited.length - 1}`,
      encounter: node.encounter as string,
      deck: run.deck,
      ...(Object.keys(run.hp).length > 0 && { hp: run.hp }),
      ...(run.difficulty && { difficulty: run.difficulty }),
    };
    const built = build(game, setupOptions);
    if ('error' in built) return built.error;
    const started = Session.start(built.rules, built.setup, built.versions);
    if (!started.ok) return { ok: false, error: started.error };
    const side = built.setup.sides.find((s) => s.controller === 'human')?.id ?? (built.setup.sides[0]?.id as SideId);
    running = { ...built.parts, session: started.session, side, options: setupOptions, ai: aiFor(game, run.seed), run };
    const events = runAi(running);
    running.undoFloor = running.session.log.actions.length;
    advanceRun(running);
    return { ok: true, type: 'snapshot', snapshot: snapshot(running, events) };
  };

  const playable = () => registry.list().filter(isPlayable).map(listing);
  const safely = <T,>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  const aiFor = (game: GameListing, seed: string | number) => options.ai?.(game) ?? randomPolicy(`ai:${String(seed)}`);
  const issuesText = (issues: { package?: string; file?: string; pointer: string; message: string }[]) =>
    issues.map((i) => `${i.package ? `${i.package} ` : ''}${i.file ?? ''}${i.pointer}: ${i.message}`).join('\n');

  /** Registers a package from its files (replacing one with the same id); assets become object URLs. */
  const load = async (files: Record<string, Uint8Array>): Promise<{ id: string } | { error: EngineReply }> => {
    const urls: Record<string, string> = {};
    for (const [path, data] of Object.entries(files)) {
      if (path.startsWith('assets/') && typeof URL.createObjectURL === 'function') urls[path] = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeOf(path) }));
    }
    const loaded = await registry.loadFiles(filesSource(files), { replace: true, assets: { url: (path) => urls[path] ?? path } });
    if (!loaded.ok) return { error: { ok: false, error: { code: 'invalid-package', message: issuesText(loaded.issues) } } };
    return { id: loaded.package.manifest.id };
  };

  // Packages bundled with the host load first; requests wait for them.
  loading = (async () => {
    for (const url of options.urls ?? []) await registry.import(url);
    for (const pending of options.files ?? []) {
      const files = await pending;
      const loaded = await load(files);
      if ('error' in loaded) console.warn(`a bundled package failed to load: ${loaded.error.ok ? '' : loaded.error.error.message}`);
    }
  })();

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
    running = { ...game, ...built.parts, session: started.session, undoFloor: started.session.log.actions.length };
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
          // A content-only game with a run plays the run, unless one encounter is asked for.
          if (!request.encounter && !request.scenario && !pkg.createRules) {
            const resolved = registry.resolve(request.game);
            const ruleset = resolved.ok ? safely(() => rulesetOf(resolved.game)) : null;
            const map = ruleset ? runMapOf(ruleset) : null;
            if (ruleset && map && resolved.ok) {
              const problems = runMapIssues(map);
              if (problems.length > 0) return { ok: false, error: { code: 'invalid-package', message: `run map: ${problems.map((p) => `${p.pointer} ${p.message}`).join('; ')}` } };
              const prefix = `${pkg.manifest.id}:`;
              const q = (ref: string) => (ref.includes(':') ? ref : `${prefix}${ref}`);
              const qualified: RunMap = { start: map.start, nodes: map.nodes.map((n) => ({ ...n, ...(n.encounter && { encounter: q(n.encounter) }) })) };
              running = null;
              return enter(
                listing(pkg),
                {
                  map: qualified,
                  branching: ruleset.run?.map !== undefined,
                  node: map.start,
                  visited: [],
                  deck: ruleset.player.deck.map((def) => ({ def: q(def) })),
                  hp: {},
                  seed: request.seed,
                  carryHp: ruleset.run?.carryHp ?? true,
                  ...(request.difficulty && { difficulty: request.difficulty }),
                  status: 'playing',
                  unlocked: startingStrains(ruleset, request.seed),
                },
                map.start,
              );
            }
          }
          const options: SetupOptions = {
            seed: request.seed,
            ...(request.encounter && { encounter: request.encounter }),
            ...(request.scenario && { scenario: request.scenario }),
            ...(request.hand && { hand: request.hand }),
            ...(request.difficulty && { difficulty: request.difficulty }),
          };
          const built = build(listing(pkg), options);
          if ('error' in built) return built.error;
          const started = Session.start(built.rules, built.setup, built.versions);
          if (!started.ok) return { ok: false, error: started.error };
          const side = built.setup.sides.find((s) => s.controller === 'human')?.id ?? (built.setup.sides[0]?.id as SideId);
          running = { ...built.parts, session: started.session, side, options, ai: aiFor(built.parts.game, request.seed) };
          const events = runAi(running);
          running.undoFloor = running.session.log.actions.length;
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, events) };
        }

        case 'act': {
          if (!running) return { ok: false, error: { code: 'not-started', message: 'no game is running' } };
          if (request.action.side !== running.side) {
            return { ok: false, error: { code: 'illegal-action', message: `the UI plays side '${running.side}'` } };
          }
          const before = running.session.state;
          const result = running.session.apply(request.action);
          if (!result.ok) return { ok: false, error: result.error };
          const logged = running.session.log.actions.length;
          const events = [...result.events, ...runAi(running)];
          // Undo stops at anything that showed the player something new, used chance, or let the other side act.
          if (!takeBackable(running, before, request.action) || running.session.log.actions.length !== logged) running.undoFloor = running.session.log.actions.length;
          advanceRun(running);
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, events) };
        }

        case 'undo': {
          if (!running) return { ok: false, error: { code: 'not-started', message: 'no game is running' } };
          const log = running.session.log;
          if (running.rules.undo !== 'turn' || running.session.state.outcome || log.actions.length <= (running.undoFloor ?? 0)) {
            return { ok: false, error: { code: 'illegal-action', message: 'there is nothing to undo' } };
          }
          const started = Session.start(running.rules, log.setup, log.packages);
          if (!started.ok) return { ok: false, error: started.error };
          for (const action of log.actions.slice(0, -1)) {
            const result = started.session.apply(action);
            if (!result.ok) return { ok: false, error: result.error };
          }
          running = { ...running, session: started.session };
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, []) };
        }

        case 'debug':
        case 'branch': {
          if (!options.debug) return { ok: false, error: { code: 'illegal-action', message: 'this engine does not allow debugging' } };
          if (!running) return { ok: false, error: { code: 'not-started', message: 'no game is running' } };
          const log = running.session.log;
          const at = request.type === 'branch' ? request.at : (request.at ?? log.actions.length);
          if (!Number.isInteger(at) || at < 0 || at > log.actions.length) {
            return { ok: false, error: { code: 'illegal-action', message: `there is no step ${at}` } };
          }
          if (request.type === 'branch') {
            const started = Session.start(running.rules, log.setup, log.packages);
            if (!started.ok) return { ok: false, error: started.error };
            for (const action of log.actions.slice(0, at)) {
              const result = started.session.apply(action);
              if (!result.ok) return { ok: false, error: result.error };
            }
            running = { ...running, session: started.session, undoFloor: at };
            if (running.run) running.run = { ...running.run, status: 'playing' };
            const events = runAi(running);
            advanceRun(running);
            return { ok: true, type: 'snapshot', snapshot: { ...snapshot(running, events), notice: `Rewound to step ${at}; play on from here.` } };
          }
          // Replay from the setup, keeping each action's events and the states around `at`.
          const created = createGame(running.rules, log.setup);
          if (!created.ok) return { ok: false, error: created.error };
          let state = created.state;
          let previous: GameState<unknown> | null = null;
          let shown = state;
          const actions: { action: Action; events: GameEvent[] }[] = [];
          for (const [i, action] of log.actions.entries()) {
            const result = apply(running.rules, state, action);
            if (!result.ok) return { ok: false, error: result.error };
            actions.push({ action, events: result.events });
            if (i + 1 === at) {
              previous = state;
              shown = result.state;
            }
            state = result.state;
          }
          const sides = shown.sides.map((s) => s.id);
          const rules = running.rules;
          return {
            ok: true,
            type: 'debug',
            debug: { actions, at, state: shown, previous, views: Object.fromEntries(sides.map((side) => [side, viewState(rules, shown, side)])) },
          };
        }

        case 'chooseReward': {
          const run = running?.run;
          if (!running || !run || run.status !== 'reward') return { ok: false, error: { code: 'illegal-action', message: 'no reward to choose' } };
          if (request.card !== null && !run.rewards?.includes(request.card)) {
            return { ok: false, error: { code: 'illegal-action', message: `'${request.card}' is not one of the rewards` } };
          }
          const { rewards: _offered, offer, ...rest } = run;
          // Taking a junction's card connects its strain.
          const connected = offer === 'strain' && request.card !== null ? strainsOf(rulesetOf(running.resolved), standardInput(running.resolved), request.card) : [];
          return onward(running, { ...rest, unlocked: [...new Set([...run.unlocked, ...connected])], deck: request.card === null ? run.deck : [...run.deck, { def: request.card }] });
        }

        case 'chooseService': {
          const run = running?.run;
          const service = run?.service;
          if (!running || !run || run.status !== 'service' || !service) return { ok: false, error: { code: 'illegal-action', message: 'there is nothing here to choose' } };
          const refuse = (message: string): EngineReply => ({ ok: false, error: { code: 'illegal-action', message } });
          const { service: _done, ...rest } = run;
          const choice = request.choice;
          const cards = running.resolved.definitions.cards;
          if (choice.action === 'leave') return onward(running, rest);
          if (service.kind === 'spring' && choice.action === 'heal') {
            const units = running.resolved.definitions.units;
            const ruleset = rulesetOf(running.resolved);
            const scale = difficultyScale(ruleset, difficultyOf(ruleset, run.difficulty))[ruleset.player.side ?? 'player'];
            const max = (def: string, now: number) => scaledHp(units[def]?.hp ?? now, scale);
            const hp = Object.fromEntries(Object.entries(run.hp).map(([def, now]) => [def, Math.min(max(def, now), now + Math.ceil(max(def, now) * 0.3))]));
            return onward(running, { ...rest, hp }, 'The spring restores 30% of your HP.');
          }
          if (service.kind === 'spring' && choice.action === 'remove') {
            const card = run.deck[choice.index];
            if (!card) return refuse(`there is no card ${choice.index} in the deck`);
            return onward(running, { ...rest, deck: run.deck.filter((_, i) => i !== choice.index) }, `${running.catalog.names[card.def] ?? card.def} leaves your deck.`);
          }
          if (service.kind === 'fruiting' && choice.action === 'take') {
            if (!service.offer.includes(choice.card)) return refuse(`'${choice.card}' is not on offer`);
            return onward(running, { ...rest, deck: [...run.deck, { def: choice.card }] });
          }
          if (service.kind === 'fruiting' && choice.action === 'upgrade') {
            const card = run.deck[choice.index];
            if (!card || card.upgraded || !cards[card.def]?.upgrade) return refuse(`card ${choice.index} can't be upgraded`);
            return onward(running, { ...rest, deck: run.deck.map((c, i) => (i === choice.index ? { ...c, upgraded: true } : c)) }, `${running.catalog.names[card.def] ?? card.def} is upgraded.`);
          }
          return refuse(`a ${service.kind} doesn't offer '${choice.action}'`);
        }

        case 'chooseNode': {
          const run = running?.run;
          if (!running || !run || run.status !== 'map') return { ok: false, error: { code: 'illegal-action', message: 'there is no path to choose' } };
          if (!run.choices?.includes(request.node)) return { ok: false, error: { code: 'illegal-action', message: `'${request.node}' is not one of the paths` } };
          return enter(running.game, run, request.node);
        }

        case 'view':
          if (!running) return { ok: false, error: { code: 'not-started', message: 'no game is running' } };
          return { ok: true, type: 'snapshot', snapshot: snapshot(running, []) };
      }
    },
  };
}
