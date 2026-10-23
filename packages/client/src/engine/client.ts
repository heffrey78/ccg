/**
 * The UI's side of the engine API: a typed client over a transport. Use
 * `workerTransport` on web (the engine in a Web Worker keeps the UI responsive
 * while AI thinks) or `localTransport` to run the host in-process.
 */
import type { EngineHost } from './host.js';
import type { EngineReply, EngineRequest, GameListing, Snapshot } from './protocol.js';
import type { Action } from '@ccg/core';

export interface EngineTransport {
  request(request: EngineRequest): Promise<EngineReply>;
}

export function localTransport(host: EngineHost): EngineTransport {
  // Copy through JSON so in-process use behaves like a worker (no shared objects).
  return { request: async (r) => JSON.parse(JSON.stringify(await host.handle(JSON.parse(JSON.stringify(r)) as EngineRequest))) as EngineReply };
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

  start(game: string, seed: string | number, encounter?: string): Promise<Snapshot> {
    return this.snapshot({ type: 'start', game, seed, ...(encounter && { encounter }) });
  }

  act(action: Action): Promise<Snapshot> {
    return this.snapshot({ type: 'act', action });
  }

  view(): Promise<Snapshot> {
    return this.snapshot({ type: 'view' });
  }

  private async snapshot(request: EngineRequest): Promise<Snapshot> {
    const reply = await this.transport.request(request);
    if (!reply.ok) throw new EngineError(reply.error.code, reply.error.message);
    if (reply.type !== 'snapshot') throw new EngineError('protocol', 'expected a snapshot');
    return reply.snapshot;
  }
}
