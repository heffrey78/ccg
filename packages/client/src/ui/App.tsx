import { useCallback, useEffect, useState } from 'react';
import type { Action, GameEvent } from '@ccg/core';
import type { EngineClient } from '../engine/client.js';
import type { GameListing, Snapshot } from '../engine/protocol.js';
import type { Platform } from '../platform.js';
import { Encounter } from './Encounter.js';
import { GameSelect } from './GameSelect.js';

export interface AppProps {
  engine: EngineClient;
  platform: Platform;
  /** Seed for new games; random per page load by default. */
  seed?: string | number;
}

export function App({ engine, platform, seed }: AppProps) {
  const [games, setGames] = useState<GameListing[] | null>(null);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void engine.listGames().then(setGames, (e: Error) => setError(e.message));
    void platform.settings.get<string | null>('lastPlayed', null).then(setLastPlayed);
  }, [engine, platform]);

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
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      {error && <p role="alert">{error}</p>}
      {snapshot ? (
        <Encounter snapshot={snapshot} log={log} busy={busy} onAct={(a: Action) => void run(() => engine.act(a))} onQuit={() => setSnapshot(null)} />
      ) : games ? (
        <GameSelect games={games} lastPlayed={lastPlayed} onStart={start} />
      ) : (
        <p>Loading…</p>
      )}
    </main>
  );
}
