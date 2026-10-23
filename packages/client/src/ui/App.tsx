import { useCallback, useEffect, useState } from 'react';
import type { Action, GameEvent } from '@ccg/core';
import type { EngineClient } from '../engine/client.js';
import type { GameListing, Snapshot } from '../engine/protocol.js';
import type { Platform } from '../platform.js';
import { DebugEncounter } from './DebugEncounter.js';
import { Encounter } from './Encounter.js';
import { GameSelect } from './GameSelect.js';
import type { BoardRenderer } from './play/Board.js';
import { CSS } from './styles.js';

export interface AppProps {
  engine: EngineClient;
  platform: Platform;
  /** Seed for new games; random per page load by default. */
  seed?: string | number;
  /** Custom board renderers by topology kind. */
  renderers?: Record<string, BoardRenderer>;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App({ engine, platform, seed, renderers }: AppProps) {
  const [games, setGames] = useState<GameListing[] | null>(null);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [speed, setSpeed] = useState(reducedMotion() ? 0 : 1);

  useEffect(() => {
    void engine.listGames().then(setGames, (e: Error) => setError(e.message));
    void platform.settings.get<string | null>('lastPlayed', null).then(setLastPlayed);
    void platform.settings.get<number | null>('animationSpeed', null).then((s) => s !== null && setSpeed(s));
  }, [engine, platform]);

  const changeSpeed = (s: number) => {
    setSpeed(s);
    void platform.settings.set('animationSpeed', s);
  };

  const run = useCallback(async (work: () => Promise<Snapshot>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      setSnapshot(next);
      setLog((l) => [...l, ...next.events]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const start = (game: string) => {
    setLog([]);
    void platform.settings.set('lastPlayed', game);
    setLastPlayed(game);
    void run(() => engine.start(game, seed ?? Math.floor(Math.random() * 2 ** 31)));
  };

  return (
    <main className="ccg-app" style={{ boxSizing: 'border-box', padding: 16 }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      {error && <p role="alert">{error}</p>}
      {snapshot && debug ? (
        <DebugEncounter snapshot={snapshot} log={log} busy={busy} onAct={(a: Action) => void run(() => engine.act(a))} onQuit={() => setDebug(false)} />
      ) : snapshot ? (
        <Encounter
          snapshot={snapshot}
          log={log}
          busy={busy}
          speed={speed}
          onSpeed={changeSpeed}
          onAct={(a: Action) => void run(() => engine.act(a))}
          onQuit={() => setSnapshot(null)}
          onDebug={() => setDebug(true)}
          {...(renderers && { renderers })}
        />
      ) : games ? (
        <GameSelect games={games} lastPlayed={lastPlayed} onStart={start} />
      ) : (
        <p>Loading…</p>
      )}
      </div>
    </main>
  );
}
