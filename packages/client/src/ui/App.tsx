import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameEvent } from '@ccg/core';
import type { EngineClient } from '../engine/client.js';
import type { GameListing, SaveGame, Snapshot } from '../engine/protocol.js';
import type { Platform } from '../platform.js';
import { DebugEncounter } from './DebugEncounter.js';
import { Encounter } from './Encounter.js';
import { GameSelect } from './GameSelect.js';
import type { BoardRenderer } from './play/Board.js';
import { DEFAULT_SOUND_LEVEL, type ViewMode } from './settings.js';
import { Sound } from './sound.js';
import { CSS } from './styles.js';

export interface AppProps {
  engine: EngineClient;
  platform: Platform;
  /** Seed for new games; random per page load by default. */
  seed?: string | number;
  /** Custom board renderers by topology kind. */
  renderers?: Record<string, BoardRenderer>;
  /** Start this encounter (a qualified id) instead of the game's default or run. */
  encounter?: string;
  /** Games the host can open in an editor, by id; each gets an Edit button. */
  editable?: string[];
  onEdit?(game: string): void;
}

/** The game in progress, kept through platform storage so it survives closing the app (#144). */
interface SavedGame {
  save: SaveGame;
  /** What the Continue button says: the game's name and where it was left. */
  title: string;
  detail: string;
  savedAt: number;
}
const SAVE_KEY = 'save:current';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App({ engine, platform, seed, renderers, encounter, editable, onEdit }: AppProps) {
  const [games, setGames] = useState<GameListing[] | null>(null);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [speed, setSpeed] = useState(reducedMotion() ? 0 : 1);
  const [volume, setVolume] = useState<number>(DEFAULT_SOUND_LEVEL);
  const sound = useMemo(() => new Sound(), []);
  const [autoPass, setAutoPass] = useState(0);
  const [view, setView] = useState<ViewMode>('standard');
  const [difficulties, setDifficulties] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedGame | null>(null);

  useEffect(() => {
    // Packages installed on the device load first, so they're in the list (#143).
    const installed = async () => {
      const failed: string[] = [];
      for (const pkg of (await platform.packages?.()) ?? []) {
        try {
          if ('zip' in pkg) await engine.importZip(pkg.zip);
          else await engine.loadFiles(pkg.files);
        } catch (e) {
          failed.push(`${pkg.name}: ${(e as Error).message}`);
        }
      }
      if (failed.length > 0) setError(`Some installed packages didn't load. ${failed.join('; ')}`);
    };
    void installed()
      .catch((e: Error) => setError(e.message))
      .then(() => engine.listGames())
      .then((list) => list && setGames(list), (e: Error) => setError(e.message));
    void platform.settings.get<string | null>('lastPlayed', null).then(setLastPlayed);
    void platform.settings.get<number | null>('animationSpeed', null).then((s) => s !== null && setSpeed(s));
    sound.setVolume(DEFAULT_SOUND_LEVEL);
    void platform.settings.get<number>('soundVolume', DEFAULT_SOUND_LEVEL).then((v) => {
      setVolume(v);
      sound.setVolume(v);
    });
    void platform.settings.get<number>('autoPass', 0).then(setAutoPass);
    void platform.settings.get<Record<string, string>>('difficulties', {}).then(setDifficulties);
    void platform.settings.get<ViewMode>('boardView', 'standard').then((v) => v !== 'full' && setView(v));
    void platform.storage.get(SAVE_KEY).then((text) => {
      try {
        if (text) setSaved(JSON.parse(text) as SavedGame);
      } catch {
        // An unreadable save is no save.
      }
    });
  }, [engine, platform]);

  /** Saves after every step; a finished game or run has nothing to continue. */
  const persist = async (next: Snapshot) => {
    const finished = next.view.outcome !== null && next.view.outcome !== undefined && (!next.run || next.run.status === 'won' || next.run.status === 'lost');
    if (finished) {
      setSaved(null);
      await platform.storage.delete(SAVE_KEY);
      return;
    }
    const save = await engine.exportSave();
    if (!save) return;
    const entry: SavedGame = {
      save,
      title: next.game.name,
      detail: next.run ? `Encounter ${next.run.stage} of ${next.run.total}, round ${next.view.turn.round}` : `Round ${next.view.turn.round}`,
      savedAt: Date.now(),
    };
    setSaved(entry);
    await platform.storage.set(SAVE_KEY, JSON.stringify(entry));
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const changeSpeed = (s: number) => {
    setSpeed(s);
    void platform.settings.set('animationSpeed', s);
  };
  const changeVolume = (v: number) => {
    setVolume(v);
    sound.setVolume(v);
    sound.play('card');
    void platform.settings.set('soundVolume', v);
  };
  useEffect(() => sound.attach(document), [sound]);
  useEffect(() => platform.onBackground?.((background) => sound.setHidden(background)), [platform, sound]);
  // Back closes what's open in the game, then leaves the game, which stays saved, then the app (#162).
  const closeRef = useRef<(() => boolean) | null>(null);
  const backRef = useRef(() => {});
  backRef.current = () => {
    if (debug) setDebug(false);
    else if (snapshot && closeRef.current?.()) return;
    else if (snapshot) setSnapshot(null);
    else platform.exit?.();
  };
  useEffect(() => platform.onBack?.(() => backRef.current()), [platform]);
  // Full screen needs a click to enter, so only the windowed views are remembered.
  const changeView = (v: ViewMode) => {
    setView(v);
    if (v !== 'full') void platform.settings.set('boardView', v);
  };

  const run = useCallback(async (work: () => Promise<Snapshot>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      setSnapshot(next);
      setLog((l) => [...l, ...next.events]);
      void persistRef.current(next).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const start = (game: string, difficulty?: string) => {
    setLog([]);
    void platform.settings.set('lastPlayed', game);
    setLastPlayed(game);
    void run(() =>
      engine.start(game, seed ?? Math.floor(Math.random() * 2 ** 31), {
        ...(encounter?.startsWith(`${game}:`) && { encounter }),
        ...(difficulty && { difficulty }),
      }),
    );
  };
  const chooseDifficulty = (game: string, level: string) => {
    const next = { ...difficulties, [game]: level };
    setDifficulties(next);
    void platform.settings.set('difficulties', next);
  };

  return (
    <main className="ccg-app" style={{ boxSizing: 'border-box', padding: 16 }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: snapshot && !debug && view !== 'standard' ? 'none' : 1120, margin: '0 auto' }}>
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
          closeRef={closeRef}
          sound={sound}
          volume={volume}
          onVolume={changeVolume}
          view={view}
          onView={changeView}
          {...(platform.setFullscreen && { setFullscreen: platform.setFullscreen })}
          onAct={(a: Action) => void run(() => engine.act(a))}
          onQuit={() => setSnapshot(null)}
          onDebug={() => setDebug(true)}
          onUndo={() => void run(() => engine.undo())}
          onChooseService={(choice) => void run(() => engine.chooseService(choice))}
          onChooseNode={(node) => {
            setLog([]);
            void run(() => engine.chooseNode(node));
          }}
          autoPass={autoPass}
          onAutoPass={(seconds) => {
            setAutoPass(seconds);
            void platform.settings.set('autoPass', seconds);
          }}
          onChooseReward={(card) => {
            setLog([]);
            void run(() => engine.chooseReward(card));
          }}
          {...(renderers && { renderers })}
        />
      ) : games ? (
        <GameSelect
          games={games}
          lastPlayed={lastPlayed}
          difficulties={difficulties}
          onDifficulty={chooseDifficulty}
          {...(onEdit && { onEdit, editable })}
          onStart={start}
          {...(saved && {
            resume: { title: saved.title, detail: saved.detail, savedAt: saved.savedAt },
            onContinue: () => {
              setLog([]);
              void run(() => engine.loadSave(saved.save)).then(() => undefined);
            },
          })}
          {...(platform.revealPackages && { onRevealPackages: () => void platform.revealPackages?.().catch((e: Error) => setError(e.message)) })}
          {...(!platform.playOnly && {
            onImport: (file: File) =>
              void file
                .arrayBuffer()
                .then((buffer) => engine.importZip(new Uint8Array(buffer)))
                .then(
                  ({ games: list, loaded }) => {
                    setGames(list);
                    setLastPlayed(loaded);
                    setError(null);
                  },
                  (e: Error) => setError(e.message),
                ),
          })}
        />
      ) : (
        <p>Loading…</p>
      )}
      </div>
    </main>
  );
}
