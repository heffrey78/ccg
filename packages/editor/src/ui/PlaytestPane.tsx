/**
 * The playtest pane (#42): runs the project being edited in the play
 * client's encounter screen. Edits apply while you play, either keeping the
 * game state ("hot") or replaying the actions so far under the new content;
 * any setup can be saved as a scenario.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameEvent } from '@ccg/core';
import type { ContentItem } from '@ccg/content';
import { CSS as CLIENT_CSS, DebugEncounter, Encounter } from '@ccg/client';
import type { EngineClient, Snapshot } from '@ccg/client/engine';
import { itemsOfKind, projectFiles, type Project } from '../project.js';
import { slug } from './ProjectPicker.js';

export interface PlaytestPaneProps {
  project: Project;
  /** Problems in the project; with any, changes cannot be applied. */
  problems: number;
  engine: EngineClient;
  onSaveScenario(item: ContentItem): void;
}

type Mode = 'hot' | 'replay';

export function PlaytestPane({ project, problems, engine, onSaveScenario }: PlaytestPaneProps) {
  const encounters = itemsOfKind(project, 'encounter');
  const scenarios = itemsOfKind(project, 'scenario');
  const [target, setTarget] = useState(() => (scenarios[0] ? `scenario:${scenarios[0][1].id}` : `encounter:${encounters[0]?.[1].id ?? ''}`));
  const [seed, setSeed] = useState('1');
  const [mode, setMode] = useState<Mode>('hot');
  const [auto, setAuto] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [debug, setDebug] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pkg = project.manifest.id;
  const [kind, id] = target.split(':') as ['encounter' | 'scenario', string];

  const attempt = async (work: () => Promise<Snapshot | null>, keepLog = true) => {
    setBusy(true);
    try {
      const next = await work();
      if (next) {
        setSnapshot(next);
        setLog((l) => (keepLog ? [...l, ...next.events] : next.events));
        setMessage(next.notice ?? null);
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The project the running game was built from or last updated to.
  const applied = useRef(project);
  const seedValue = /^-?\d+$/.test(seed.trim()) ? Number(seed) : seed.trim() || 1;
  const start = () =>
    attempt(async () => {
      applied.current = project;
      await engine.loadFiles(projectFiles(project));
      return engine.start(pkg, seedValue, kind === 'scenario' ? { scenario: `${pkg}:${id}` } : { encounter: `${pkg}:${id}` });
    }, false);

  // Apply edits to the running game shortly after they are made.
  useEffect(() => {
    if (!snapshot || !auto || applied.current === project) return;
    const timer = setTimeout(() => {
      applied.current = project;
      if (problems > 0) {
        setMessage(`Fix ${problems} problem${problems === 1 ? '' : 's'} to apply your changes.`);
        return;
      }
      void attempt(() => engine.reload(projectFiles(project), mode));
    }, 400);
    return () => clearTimeout(timer);
    // `attempt` is stable in effect; re-running on its identity would re-apply.
  }, [project, auto, mode, problems, snapshot === null]);

  const saveScenario = () => {
    const encounter = kind === 'scenario' ? (project.items[`scenario:${id}`] as { encounter?: string } | undefined)?.encounter : id;
    if (!encounter) return;
    let scenarioId = slug(`${encounter}-seed-${seed}`) || 'scenario';
    for (let n = 2; project.items[`scenario:${scenarioId}`]; n++) scenarioId = `${slug(`${encounter}-seed-${seed}`)}-${n}`;
    const name = `${project.items[`encounter:${encounter}`]?.name ?? encounter} (seed ${seed})`;
    onSaveScenario({ formatVersion: 1, kind: 'scenario', id: scenarioId, name, encounter, seed: seedValue } as ContentItem);
    setTarget(`scenario:${scenarioId}`);
  };

  const options = useMemo(
    () => [
      ...scenarios.map(([, s]) => ({ value: `scenario:${s.id}`, label: `Scenario: ${s.name}` })),
      ...encounters.map(([, e]) => ({ value: `encounter:${e.id}`, label: `Encounter: ${e.name}` })),
    ],
    [scenarios, encounters],
  );
  const act = (action: Action) => void attempt(() => engine.act(action));

  return (
    <section className="ccg-playtest" aria-labelledby="playtest-heading">
      <header className="ccg-row">
        <h2 id="playtest-heading">Playtest</h2>
        <select aria-label="Encounter or scenario" value={target} onChange={(e) => setTarget(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {kind === 'encounter' && (
          <label>
            Seed <input aria-label="Seed" value={seed} size={8} onChange={(e) => setSeed(e.target.value)} />
          </label>
        )}
        <button type="button" className="ccg-primary" disabled={busy || options.length === 0} onClick={() => void start()}>
          {snapshot ? 'Restart' : 'Start'}
        </button>
        {kind === 'encounter' && (
          <button type="button" disabled={busy} onClick={saveScenario} title="Save this encounter and seed as a scenario you can rerun">
            Save as scenario
          </button>
        )}
        <span className="ccg-spacer" />
        <label>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Apply edits live
        </label>
        <select aria-label="How edits apply" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="hot">keep the game state</option>
          <option value="replay">replay the actions so far</option>
        </select>
      </header>
      {message && (
        <p className="ccg-muted" role="status" aria-label="Playtest status">
          {message}
        </p>
      )}
      {snapshot ? (
        <div className="ccg-app">
          <style>{CLIENT_CSS}</style>
          {debug ? (
            <DebugEncounter snapshot={snapshot} log={log} busy={busy} onAct={act} onQuit={() => setDebug(false)} />
          ) : (
            <Encounter
              snapshot={snapshot}
              log={log}
              busy={busy}
              speed={speed}
              onSpeed={setSpeed}
              onAct={act}
              onQuit={() => setSnapshot(null)}
              onDebug={() => setDebug(true)}
            />
          )}
        </div>
      ) : (
        <p className="ccg-muted">Start an encounter to play the project as it is now. Edits apply while you play.</p>
      )}
    </section>
  );
}
