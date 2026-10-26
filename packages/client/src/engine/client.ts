/**
 * The UI's side of the engine API: a typed client over a transport. Use
 * `workerTransport` on web (the engine in a Web Worker keeps the UI responsive
 * while AI thinks) or `localTransport` to run the host in-process.
 */
import type { EngineHost } from './host.js';
import type { DebugInfo, EngineReply, EngineRequest, GameListing, SaveGame, ServiceChoice, Snapshot } from './protocol.js';
import type { Action } from '@ccg/core';

export interface EngineTransport {
  request(request: EngineRequest): Promise<EngineReply>;
}

export function localTransport(host: EngineHost): EngineTransport {
  // Copy like postMessage does, so in-process use behaves like a worker (no shared objects).
  return { request: async (r) => structuredClone(await host.handle(structuredClone(r))) };
}

interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export function workerTransport(worker: WorkerLike): EngineTransport {
  let next = 0;
  const pending = new Map<number, (reply: EngineReply) => void>();
  worker.addEventListener('message', (event) => {
    const { id, reply } = event.data as { id: number; reply: EngineReply };
    pending.get(id)?.(reply);
    pending.delete(id);
  });
  return {
    request(request) {
      const id = next++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ id, request });
      });
    },
  };
}

/** Serves a host inside a worker: call from the worker's entry module. */
export function serveEngine(host: EngineHost, scope: WorkerLike): void {
  scope.addEventListener('message', (event) => {
    const { id, request } = event.data as { id: number; request: EngineRequest };
    void host.handle(request).then(
      (reply) => scope.postMessage({ id, reply }),
      (error: unknown) => scope.postMessage({ id, reply: { ok: false, error: { code: 'invalid-package', message: String(error) } } }),
    );
  });
}

export class EngineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class EngineClient {
  constructor(private readonly transport: EngineTransport) {}

  async listGames(): Promise<GameListing[]> {
    const reply = await this.transport.request({ type: 'listGames' });
    if (!reply.ok) throw new EngineError(reply.error.code, reply.error.message);
    if (reply.type !== 'games') throw new EngineError('protocol', 'expected a game list');
    return reply.games;
  }

  /** Loads a zipped game package; returns the updated game list and the id it loaded. */
  async importZip(data: Uint8Array): Promise<{ games: GameListing[]; loaded: string }> {
    const reply = await this.transport.request({ type: 'importZip', data });
    if (!reply.ok) throw new EngineError(reply.error.code, reply.error.message);
    if (reply.type !== 'games' || !reply.loaded) throw new EngineError('protocol', 'expected a game list');
    return { games: reply.games, loaded: reply.loaded };
  }

  /** Loads a game package from its files; returns the updated game list and the id it loaded. */
  async loadFiles(files: Record<string, Uint8Array>): Promise<{ games: GameListing[]; loaded: string }> {
    const reply = await this.transport.request({ type: 'loadFiles', files });
    if (!reply.ok) throw new EngineError(reply.error.code, reply.error.message);
    if (reply.type !== 'games' || !reply.loaded) throw new EngineError('protocol', 'expected a game list');
    return { games: reply.games, loaded: reply.loaded };
  }

  /** Applies new package files to the running game: `hot` keeps the state, `replay` replays the log. */
  reload(files: Record<string, Uint8Array>, mode: 'hot' | 'replay'): Promise<Snapshot> {
    return this.snapshot({ type: 'reload', files, mode });
  }

  start(game: string, seed: string | number, options: { encounter?: string; scenario?: string; hand?: string[]; difficulty?: string } = {}): Promise<Snapshot> {
    return this.snapshot({
      type: 'start',
      game,
      seed,
      ...(options.encounter && { encounter: options.encounter }),
      ...(options.scenario && { scenario: options.scenario }),
      ...(options.hand && { hand: options.hand }),
      ...(options.difficulty && { difficulty: options.difficulty }),
    });
  }

  /** Between a run's encounters: take a reward card (or none) and start the next encounter. */
  chooseReward(card: string | null): Promise<Snapshot> {
    return this.snapshot({ type: 'chooseReward', card });
  }

  /** In a branching run: go to one of the offered next nodes. */
  chooseNode(node: string): Promise<Snapshot> {
    return this.snapshot({ type: 'chooseNode', node });
  }

  /** At a spring or fruiting log: heal, remove, take, upgrade, or leave. */
  chooseService(choice: ServiceChoice): Promise<Snapshot> {
    return this.snapshot({ type: 'chooseService', choice });
  }

  /** Takes back the player's last action, when the game allows it. */
  undo(): Promise<Snapshot> {
    return this.snapshot({ type: 'undo' });
  }

  /** Debug hosts only: the authoritative state after `at` actions (default: now). */
  async debug(at?: number): Promise<DebugInfo> {
    const reply = await this.transport.request({ type: 'debug', ...(at !== undefined && { at }) });
    if (!reply.ok) throw new EngineError(reply.error.code, reply.error.message);
    if (reply.type !== 'debug') throw new EngineError('protocol', 'expected debug info');
    return reply.debug;
  }

  /** Debug hosts only: rewind to after `at` actions and play on from there. */
  branch(at: number): Promise<Snapshot> {
    return this.snapshot({ type: 'branch', at });
  }

  act(action: Action): Promise<Snapshot> {
    return this.snapshot({ type: 'act', action });
  }

  view(): Promise<Snapshot> {
    return this.snapshot({ type: 'view' });
  }

  /** The game in progress as a save, or null when none is running (#144). */
  async exportSave(): Promise<SaveGame | null> {
    const reply = await this.transport.request({ type: 'exportSave' });
    if (!reply.ok) throw new EngineError(reply.error.code, reply.error.message);
    return reply.type === 'save' ? reply.save : null;
  }

  /** Continues a saved game exactly where it was. */
  loadSave(save: SaveGame): Promise<Snapshot> {
    return this.snapshot({ type: 'loadSave', save });
  }

  private async snapshot(request: EngineRequest): Promise<Snapshot> {
    const reply = await this.transport.request(request);
    if (!reply.ok) throw new EngineError(reply.error.code, reply.error.message);
    if (reply.type !== 'snapshot') throw new EngineError('protocol', 'expected a snapshot');
    return reply.snapshot;
  }
}
