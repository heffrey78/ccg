/**
 * The playtest pane (#42): runs the project being edited in the play
 * client's encounter screen. Edits apply while you play, either keeping the
 * game state ("hot") or replaying the actions so far under the new content;
 * any setup can be saved as a scenario.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameEvent, GameState } from '@ccg/core';
import type { ContentItem } from '@ccg/content';
import { DebugEncounter, Encounter } from '@ccg/client';
import type { EngineClient, Snapshot } from '@ccg/client/engine';
import { itemsOfKind, projectFiles, type Project } from '../project.js';
import { DebugPanel } from './DebugPanel.js';
import { slug } from './ProjectPicker.js';

export interface PlaytestPaneProps {
  project: Project;
  /** Problems in the project; with any, changes cannot be applied. */
  problems: number;
  engine: EngineClient;
  /** Starts a game with this card first in the hand; `n` changes on every request. */
  tryCard?: { card: string; n: number } | null;
  onSaveScenario(item: ContentItem): void;
}

type Mode = 'hot' | 'replay';

export function PlaytestPane({ project, problems, engine, tryCard, onSaveScenario }: PlaytestPaneProps) {
  const encounters = itemsOfKind(project, 'encounter');
  const scenarios = itemsOfKind(project, 'scenario');
  const [target, setTarget] = useState(() => (scenarios[0] ? `scenario:${scenarios[0][1].id}` : `encounter:${encounters[0]?.[1].id ?? ''}`));
  const [seed, setSeed] = useState('1');
  const [mode, setMode] = useState<Mode>('hot');
  const [auto, setAuto] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [debug, setDebug] = useState(false);
  const [debugger_, setDebugger] = useState(false);
  // How the running game was set up, to save it as a scenario (a run or a tried card can't be).
  const [setupOf, setSetupOf] = useState<{ encounter: string; seed: string | number; hand?: string[]; deck?: string[] } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<GameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pkg = project.manifest.id;
  const [kind, id] = target.split(':') as ['encounter' | 'scenario' | 'run', string];

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
  const start = (hand?: string[]) =>
    attempt(async () => {
      applied.current = project;
      await engine.loadFiles(projectFiles(project));
      // Trying a card plays it in an encounter: the selected one, or the first.
      const encounter = kind === 'encounter' ? id : encounters[0]?.[1].id;
      if (hand || kind === 'run') setSetupOf(null);
      if (hand) return engine.start(pkg, seedValue, { ...(encounter && { encounter: `${pkg}:${encounter}` }), hand });
      if (kind === 'run') return engine.start(pkg, seedValue);
      if (kind === 'scenario') {
        const s = project.items[`scenario:${id}`] as unknown as { encounter: string; seed: string | number; hand?: string[]; deck?: string[] } | undefined;
        setSetupOf(s ? { encounter: s.encounter, seed: s.seed, ...(s.hand && { hand: s.hand }), ...(s.deck && { deck: s.deck }) } : null);
        return engine.start(pkg, seedValue, { scenario: `${pkg}:${id}` });
      }
      setSetupOf({ encounter: id, seed: seedValue });
      return engine.start(pkg, seedValue, { encounter: `${pkg}:${id}` });
    }, false);

  useEffect(() => {
    if (tryCard) void start([`${pkg}:${tryCard.card}`]);
    // Only a new request starts a game.
  }, [tryCard?.n]);

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

  const hasRun = itemsOfKind(project, 'ruleset').some(([, r]) => r.run);
  const options = useMemo(
    () => [
      ...(hasRun ? [{ value: 'run:', label: 'Run: every encounter in order' }] : []),
      ...scenarios.map(([, s]) => ({ value: `scenario:${s.id}`, label: `Scenario: ${s.name}` })),
      ...encounters.map(([, e]) => ({ value: `encounter:${e.id}`, label: `Encounter: ${e.name}` })),
    ],
    [scenarios, encounters, hasRun],
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
        {kind !== 'scenario' && (
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
        {snapshot && (
          <button type="button" aria-pressed={debugger_} onClick={() => setDebugger((d) => !d)}>
            Debugger
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
              onChooseReward={(card) => void attempt(() => engine.chooseReward(card), false)}
              onUndo={() => void attempt(() => engine.undo())}
              onChooseNode={(node) => void attempt(() => engine.chooseNode(node), false)}
              onChooseService={(choice) => void attempt(() => engine.chooseService(choice), false)}
            />
          )}
        </div>
      ) : (
        <p className="ccg-muted">Start an encounter to play the project as it is now. Edits apply while you play.</p>
      )}
      {snapshot && debugger_ && (
        <DebugPanel
          engine={engine}
          snapshot={snapshot}
          names={snapshot.catalog.names}
          onSnapshot={(next) => {
            setSnapshot(next);
            setLog([]);
            setMessage(next.notice ?? null);
          }}
          {...(setupOf && { onSaveTest: (actions: Action[], state: GameState<unknown>) => onSaveScenario(testScenario(project, setupOf, actions, state)) })}
        />
      )}
    </section>
  );
}

/**
 * A scenario test from a playtest: its setup, the actions so far, and
 * expectations for what is true now: the outcome, and each unit's HP where
 * its definition appears once on its side.
 */
export function testScenario(
  project: Project,
  setup: { encounter: string; seed: string | number; hand?: string[]; deck?: string[] },
  actions: Action[],
  state: GameState<unknown>,
): ContentItem {
  const pkg = `${project.manifest.id}:`;
  const local = (ref: string) => (ref.startsWith(pkg) ? ref.slice(pkg.length) : ref);
  const units = Object.values((state.world as { board?: { units: Record<string, { def: string; side: string; hp: number }> } }).board?.units ?? {});
  const expect: object[] = [{ kind: 'outcome', winner: state.outcome ? (state.outcome.winners.includes(state.sides[0]?.id ?? '') ? 'player' : 'enemy') : 'none' }];
  for (const u of units) {
    if (units.filter((o) => o.def === u.def && o.side === u.side).length > 1) continue;
    expect.push({ kind: 'unit', unit: local(u.def), side: u.side, hp: { min: u.hp, max: u.hp } });
  }
  const base = slug(`${local(setup.encounter)}-test`) || 'test';
  let id = base;
  for (let n = 2; project.items[`scenario:${id}`]; n++) id = `${base}-${n}`;
  return {
    formatVersion: 1,
    kind: 'scenario',
    id,
    name: `${project.items[`encounter:${local(setup.encounter)}`]?.name ?? setup.encounter}: ${actions.length} actions`,
    encounter: local(setup.encounter),
    seed: setup.seed,
    ...(setup.hand && { hand: setup.hand }),
    ...(setup.deck && { deck: setup.deck }),
    actions,
    expect,
  } as ContentItem;
}
