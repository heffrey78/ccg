/**
 * The editor shell (#39): toolbar with save and undo/redo, the content
 * browser, the selected item, and the validation panel. Validation reruns
 * shortly after every change, off the main thread when the host provides a
 * worker-backed validator.
 *
 * Shortcuts: Ctrl/Cmd+S save · Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z or Ctrl+Y redo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ContentKind, OpRegistry } from '@ccg/content';
import { EditorError, createItem, type Command } from '../commands.js';
import { itemKey, projectFiles, splitKey, type Project } from '../project.js';
import { guessBoard, type PreviewBoard } from '../forms/patterns.js';
import { moduleSource } from '../assets.js';
import { zipFiles } from '../stores/zip.js';
import type { EngineClient } from '@ccg/client/engine';
import { AssetPanel, importAssets } from './AssetPanel.js';
import { BalancePanel, type Simulator } from './BalancePanel.js';
import { PlaytestPane } from './PlaytestPane.js';
import { newItem } from '../templates.js';
import { testProject, type ProjectIssue } from '../validate.js';
import type { ScenarioResult } from '@ccg/core';
import { Browser } from './Browser.js';
import { ItemPanel, ManifestPanel } from './ItemPanel.js';
import { useStore, type Session } from './session.js';

export type Selection = { kind: 'manifest' } | { kind: 'item'; key: string; pointer?: string } | { kind: 'asset'; path: string } | null;

export interface WorkspaceProps {
  session: Session;
  ops: OpRegistry;
  validate(project: Project): Promise<ProjectIssue[]>;
  /** The engine playtests run in (a worker on web). */
  playtestEngine: EngineClient;
  /** Runs balance simulations (a worker pool on web). */
  simulate: Simulator;
  onClose(): void;
}

export function Workspace({ session, ops, validate, playtestEngine, simulate, onClose }: WorkspaceProps) {
  const store = useStore(session.store);
  const project = store.project;
  const [selection, setSelection] = useState<Selection>({ kind: 'manifest' });
  const [issues, setIssues] = useState<ProjectIssue[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [playtest, setPlaytest] = useState(false);
  const [balance, setBalance] = useState(false);
  const [tests, setTests] = useState<{ running: boolean; results: ScenarioResult[] | null; error: string | null } | null>(null);
  // A card to try in the playtest pane; the counter restarts it on every click.
  const [tryCard, setTryCard] = useState<{ card: string; n: number } | null>(null);
  // The board patterns are previewed on, guessed from the encounters until the author picks one.
  const [board, setBoard] = useState<PreviewBoard>(() =>
    guessBoard(Object.values(project.items).flatMap((i) => (i.kind === 'encounter' ? ((i.units as { pos: string }[] | undefined) ?? []).map((u) => u.pos) : []))),
  );

  // ---- validation, debounced ----
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      validate(project).then(
        (found) => !cancelled && setIssues(found),
        (e: Error) => !cancelled && setIssues([{ file: '', pointer: '', message: `validation failed: ${e.message}` }]),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, validate]);

  const run = useCallback(
    (label: string, command: Command): string | null => {
      try {
        store.run(label, command);
        return null;
      } catch (e) {
        if (e instanceof EditorError) return e.message;
        throw e;
      }
    },
    [store],
  );

  const save = useCallback(async () => {
    setStatus('Saving…');
    try {
      await session.save();
      setStatus('Saved');
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    }
  }, [session]);

  const download = (data: BlobPart, type: string, name: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const base = `${project.manifest.id}-${project.manifest.version}`;
  const exportZip = () => download(zipFiles(projectFiles(project)) as BlobPart, 'application/zip', `${base}.zip`);
  const exportModule = () => download(moduleSource(project), 'text/javascript', `${base}.js`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      // Let text fields keep their own undo while typing.
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (key === 's') {
        e.preventDefault();
        void save();
      } else if (key === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (key === 'y' && !typing) {
        e.preventDefault();
        store.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, store]);

  // Keep the selection valid across undo/redo and deletes.
  const shown: Selection =
    (selection?.kind === 'item' && !project.items[selection.key]) || (selection?.kind === 'asset' && !project.assets[selection.path]) ? null : selection;
  const issueKeys = useMemo(() => new Set((issues ?? []).flatMap((i) => (i.key ? [i.key] : []))), [issues]);

  const create = (kind: ContentKind, id: string, name: string) => {
    const error = run(`New ${kind} ${name}`, createItem(newItem(kind, id, name, project)));
    if (!error) setSelection({ kind: 'item', key: itemKey(kind, id) });
    return error;
  };

  const where = session.source.kind === 'folder' ? `folder ${session.source.name}` : 'this browser';
  return (
    <section className="ccg-workspace" aria-labelledby="project-heading">
      <header className="ccg-toolbar">
        <h1 id="project-heading">{project.manifest.name}</h1>
        <span className="ccg-muted">{store.dirty ? 'Unsaved changes' : `Saved in ${where}`}</span>
        <span className="ccg-spacer" />
        <button type="button" disabled={!store.canUndo} title={store.undoLabel ? `Undo ${store.undoLabel}` : undefined} aria-keyshortcuts="Control+Z" onClick={() => store.undo()}>
          Undo
        </button>
        <button type="button" disabled={!store.canRedo} title={store.redoLabel ? `Redo ${store.redoLabel}` : undefined} aria-keyshortcuts="Control+Shift+Z" onClick={() => store.redo()}>
          Redo
        </button>
        <button type="button" className="ccg-primary" disabled={!store.dirty} aria-keyshortcuts="Control+S" onClick={() => void save()}>
          Save
        </button>
        <button type="button" onClick={exportZip} title="A zip the play client loads (Play → Load a game from a zip)">
          Export zip
        </button>
        <button type="button" onClick={exportModule} title="One JavaScript file, assets included, that hosts load by URL">
          Export JS module
        </button>
        <button type="button" aria-pressed={playtest} onClick={() => setPlaytest((p) => !p)}>
          Playtest
        </button>
        <button type="button" aria-pressed={balance} onClick={() => setBalance((b) => !b)} title="Simulate many games with a bot">
          Balance
        </button>
        <button
          type="button"
          title="Run every scenario that has expectations"
          onClick={() => {
            setTests({ running: true, results: null, error: null });
            testProject(project).then(
              (results) => setTests({ running: false, results, error: null }),
              (e: Error) => setTests({ running: false, results: null, error: e.message }),
            );
          }}
        >
          Run tests
        </button>
        <button type="button" onClick={() => (store.dirty ? setConfirmClose(true) : onClose())}>
          Close
        </button>
      </header>
      {status && (
        <p className="ccg-muted" role="status">
          {status}
        </p>
      )}
      {confirmClose && (
        <div className="ccg-confirm" role="alertdialog" aria-label="Unsaved changes">
          <p>You have unsaved changes.</p>
          <button
            type="button"
            className="ccg-primary"
            onClick={() =>
              void save().then(() => {
                if (!session.store.dirty) onClose();
              })
            }
          >
            Save and close
          </button>
          <button type="button" className="ccg-danger" onClick={onClose}>
            Discard changes
          </button>
          <button type="button" onClick={() => setConfirmClose(false)}>
            Keep editing
          </button>
        </div>
      )}

      <div className="ccg-editor-main">
        <Browser
          project={project}
          selection={shown}
          issues={issueKeys}
          onSelect={setSelection}
          onCreate={create}
          onImportAssets={(files) =>
            void importAssets(project, files).then(({ command, paths }) => {
              const error = run(`Import ${paths.length === 1 ? paths[0] : `${paths.length} assets`}`, command);
              if (!error && paths[0]) setSelection({ kind: 'asset', path: paths[0] });
            })
          }
        />
        <div className="ccg-editor-center">
          {shown?.kind === 'item' ? (
            <ItemPanel
              project={project}
              ops={ops}
              issues={issues ?? []}
              run={run}
              onSelect={setSelection}
              itemKey={shown.key}
              pointer={shown.pointer}
              board={board}
              setBoard={setBoard}
              onTryCard={(card) => {
                setPlaytest(true);
                setTryCard((t) => ({ card, n: (t?.n ?? 0) + 1 }));
              }}
            />
          ) : shown?.kind === 'asset' ? (
            <AssetPanel project={project} path={shown.path} run={run} onSelect={setSelection} />
          ) : shown?.kind === 'manifest' ? (
            <ManifestPanel project={project} run={run} />
          ) : (
            <p className="ccg-muted">Select something to edit.</p>
          )}
        </div>
      </div>

      {balance && <BalancePanel project={project} simulate={simulate} onClose={() => setBalance(false)} />}
      {tests && <TestResults tests={tests} project={project} onSelect={setSelection} onClose={() => setTests(null)} />}

      {playtest && (
        <PlaytestPane
          project={project}
          problems={issues?.length ?? 0}
          engine={playtestEngine}
          tryCard={tryCard}
          onSaveScenario={(item) => {
            if (!run(`Save scenario ${item.name}`, createItem(item))) setSelection({ kind: 'item', key: itemKey('scenario', item.id) });
          }}
        />
      )}

      <ValidationPanel project={project} issues={issues} onSelect={setSelection} />
    </section>
  );
}

function ValidationPanel({ project, issues, onSelect }: { project: Project; issues: ProjectIssue[] | null; onSelect(s: Selection): void }) {
  const label = (i: ProjectIssue) => {
    if (!i.key) return i.file || 'project';
    const item = project.items[i.key];
    return item ? `${item.name} (${splitKey(i.key).kind})` : i.key;
  };
  return (
    <section className="ccg-validation" aria-labelledby="validation-heading">
      <h2 id="validation-heading">
        Problems{' '}
        <span className={issues && issues.length > 0 ? 'ccg-badge is-bad' : 'ccg-badge'}>{issues === null ? '…' : issues.length}</span>
      </h2>
      {issues !== null && issues.length === 0 && <p className="ccg-muted">No problems found.</p>}
      {issues && issues.length > 0 && (
        <ul>
          {issues.map((i, n) => (
            <li key={n}>
              {i.key ? (
                <button type="button" className="ccg-link" onClick={() => onSelect({ kind: 'item', key: i.key as string, pointer: i.pointer })}>
                  {label(i)}
                </button>
              ) : i.file === 'game.json' ? (
                <button type="button" className="ccg-link" onClick={() => onSelect({ kind: 'manifest' })}>
                  Game settings
                </button>
              ) : (
                <span>{label(i)}</span>
              )}{' '}
              <code className="ccg-muted">{i.pointer || '/'}</code> {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TestResults({
  tests,
  project,
  onSelect,
  onClose,
}: {
  tests: { running: boolean; results: ScenarioResult[] | null; error: string | null };
  project: Project;
  onSelect(s: Selection): void;
  onClose(): void;
}) {
  const failed = tests.results?.filter((r) => !r.passed).length ?? 0;
  return (
    <section className="ccg-validation" aria-labelledby="tests-heading">
      <h2 id="tests-heading">
        Tests{' '}
        {tests.results && (
          <span className={failed > 0 ? 'ccg-badge is-bad' : 'ccg-badge'}>
            {tests.results.length - failed}/{tests.results.length}
          </span>
        )}{' '}
        <button type="button" onClick={onClose} aria-label="Close tests">
          ×
        </button>
      </h2>
      {tests.running && <p className="ccg-muted">Running…</p>}
      {tests.error && <p className="ccg-error">Could not run the tests: {tests.error}</p>}
      {tests.results?.length === 0 && <p className="ccg-muted">No scenarios have expectations yet. Add some under a scenario's Test section.</p>}
      <ul aria-label="Test results">
        {tests.results?.map((r) => {
          const id = r.id.slice(project.manifest.id.length + 1);
          return (
            <li key={r.id} className={r.passed ? 'is-pass' : 'is-fail'}>
              {r.passed ? '✓' : '✗'}{' '}
              <button type="button" className="ccg-link" onClick={() => onSelect({ kind: 'item', key: `scenario:${id}` })}>
                {r.name}
              </button>
              {r.failures.map((f, i) => (
                <div key={i} className="ccg-error">
                  {f}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
