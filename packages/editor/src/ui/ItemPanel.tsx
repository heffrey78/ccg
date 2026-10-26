import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContentItem, Manifest, OpRegistry } from '@ccg/content';
import { deleteItem, duplicateItem, referencesTo, renameItem, updateItem, updateManifest, type Command } from '../commands.js';
import type { Project } from '../project.js';
import type { ProjectIssue } from '../validate.js';
import { boardIssues, describeBoard, moveEncounters, projectBoard } from '../encounters.js';
import { guessBoard, type PreviewBoard } from '../forms/patterns.js';
import { KIND_SINGULAR } from './Browser.js';
import { ItemForm } from './forms/ItemForm.js';
import type { Selection } from './Workspace.js';

export interface PanelProps {
  project: Project;
  ops: OpRegistry;
  issues: ProjectIssue[];
  /** Runs a command; returns an error message, or null. */
  run(label: string, command: Command): string | null;
  onSelect(selection: Selection): void;
}

/** A text field that commits on Enter or blur, and resets when its value changes elsewhere (undo). */
function Field({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit(v: string): void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <label className="ccg-field">
      {label}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(value);
        }}
      />
    </label>
  );
}

export function ManifestPanel({ project, run, onSelect, onPlaytest, onBalance }: Pick<PanelProps, 'project' | 'run'> & { onSelect?(selection: Selection): void; onPlaytest?(): void; onBalance?(): void }) {
  const m = project.manifest;
  const set = (field: keyof Manifest, label: string) => (value: string) => {
    const next = { ...m } as Record<string, unknown>;
    if (value === '' && field === 'description') delete next[field];
    else next[field] = value;
    run(label, updateManifest(next as unknown as Manifest));
  };
  return (
    <section className="ccg-item-panel" aria-labelledby="manifest-heading">
      <h2 id="manifest-heading">Game settings</h2>
      <p className="ccg-muted">
        Package id <code>{m.id}</code>
      </p>
      <Field label="Name" value={m.name} onCommit={set('name', 'Rename game')} />
      <Field label="Version" value={m.version} onCommit={set('version', 'Change version')} />
      <Field label="Description" value={m.description ?? ''} onCommit={set('description', 'Edit description')} />
      <Field label="Engine range" value={m.engine} onCommit={set('engine', 'Change engine range')} />
      <h3>Where to start</h3>
      <p className="ccg-muted">{contentSummary(project)}</p>
      <div className="ccg-row ccg-start-links">
        {onSelect &&
          Object.entries(project.items)
            .filter(([, i]) => i.kind === 'ruleset')
            .map(([key]) => (
              <button key={key} type="button" onClick={() => onSelect({ kind: 'item', key })} title="Board, the player's deck and hand, the run and difficulty levels">
                Rules and difficulty
              </button>
            ))}
        {onPlaytest && (
          <button type="button" onClick={onPlaytest} title="Play an encounter, a scenario or the whole run as you edit">
            Play it now
          </button>
        )}
        {onBalance && (
          <button type="button" onClick={onBalance} title="Simulate many games with a bot">
            Bot simulation
          </button>
        )}
      </div>
    </section>
  );
}

/** "34 cards, 14 units and 9 encounters", for the kinds the project has. */
function contentSummary(project: Project): string {
  const counts = new Map<string, number>();
  for (const item of Object.values(project.items)) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => `${n} ${n === 1 ? KIND_SINGULAR[kind as keyof typeof KIND_SINGULAR] : PLURAL[kind] ?? `${kind}s`}`);
  if (parts.length === 0) return 'No content yet.';
  return `This game has ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`;
}
const PLURAL: Record<string, string> = { status: 'statuses' };

export function ItemPanel({
  project,
  ops,
  issues,
  run,
  onSelect,
  itemKey,
  pointer,
  board,
  setBoard,
  onTryCard,
}: PanelProps & { itemKey: string; pointer?: string | undefined; board: PreviewBoard; setBoard(board: PreviewBoard): void; onTryCard?(card: string): void }) {
  const item = project.items[itemKey];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setConfirmDelete(false);
    setError(null);
  }, [itemKey]);
  // Jump to the field a problem points at.
  useEffect(() => {
    if (pointer === undefined) return;
    formRef.current?.querySelector(`[data-pointer="${CSS.escape(pointer)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [pointer, itemKey]);
  if (!item) return <p className="ccg-muted">This item no longer exists.</p>;

  const refs = referencesTo(project, itemKey, ops);
  const mine = issues.filter((i) => i.key === itemKey);
  const update = (label: string, fields: Partial<ContentItem>) => setError(run(label, updateItem(itemKey, { ...item, ...fields } as ContentItem)));
  const freeCopyId = () => {
    let n = 2;
    while (project.items[`${item.kind}:${item.id}-${n}`]) n++;
    return `${item.id}-${n}`;
  };

  return (
    <section className="ccg-item-panel" aria-labelledby="item-heading">
      <header className="ccg-item-header">
        <h2 id="item-heading">{item.name}</h2>
        <span className="ccg-kind">{KIND_SINGULAR[item.kind]}</span>
        <span className="ccg-spacer" />
        {item.kind === 'card' && onTryCard && (
          <button type="button" title="Start a playtest with this card in your opening hand" onClick={() => onTryCard(item.id)}>
            Try it
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const id = freeCopyId();
            const err = run(`Duplicate ${item.name}`, duplicateItem(itemKey, id));
            setError(err);
            if (!err) onSelect({ kind: 'item', key: `${item.kind}:${id}` });
          }}
        >
          Duplicate
        </button>
        <button type="button" className="ccg-danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </header>
      {confirmDelete && (
        <div className="ccg-confirm" role="alertdialog" aria-label="Confirm delete">
          <p>
            Delete {item.name}?{refs.length > 0 && ` ${refs.length} reference${refs.length === 1 ? '' : 's'} will be left pointing at nothing.`}
          </p>
          <button
            type="button"
            className="ccg-danger"
            onClick={() => {
              run(`Delete ${item.name}`, deleteItem(itemKey));
              onSelect(null);
            }}
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert" className="ccg-error">{error}</p>}
      {item.kind === 'ruleset' && <BoardFit project={project} run={run} />}

      <div className="ccg-fields">
        <Field label="Name" value={item.name} onCommit={(name) => update(`Rename ${item.name} to ${name}`, { name })} />
        <Field
          label="ID"
          value={item.id}
          onCommit={(id) => {
            const err = run(`Change id ${item.id} → ${id}`, renameItem(itemKey, id, ops));
            setError(err);
            if (!err) onSelect({ kind: 'item', key: `${item.kind}:${id}` });
          }}
        />
        <Field
          label="Tags"
          placeholder="comma, separated"
          value={((item.tags as string[] | undefined) ?? []).join(', ')}
          onCommit={(text) => {
            const tags = [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];
            const { tags: _old, ...rest } = item;
            setError(run(`Tag ${item.name}`, updateItem(itemKey, (tags.length > 0 ? { ...rest, tags } : rest) as ContentItem)));
          }}
        />
      </div>
      <p className="ccg-muted">
        File <code>{project.paths[itemKey]}</code>
      </p>

      {mine.length > 0 && (
        <ul className="ccg-issues-inline">
          {mine.map((i, n) => (
            <li key={n} className={i.severity === 'warning' ? 'is-warning' : undefined}>
              <button type="button" onClick={() => onSelect({ kind: 'item', key: itemKey, pointer: i.pointer })}>
                {i.severity === 'warning' && 'Warning: '}
                <code>{i.pointer || '/'}</code> {i.message}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Properties</h3>
      <div ref={formRef}>
        <ItemForm
          project={project}
          ops={ops}
          item={item}
          issues={mine}
          flagged={pointer}
          board={board}
          setBoard={setBoard}
          onChange={(next) => setError(run(`Edit ${item.name}`, updateItem(itemKey, next)))}
        />
      </div>
      <details className="ccg-raw">
        <summary>Raw data (read-only)</summary>
        <JsonView value={item} highlight={pointer} />
      </details>

      <h3>Used by</h3>
      {refs.length === 0 ? (
        <p className="ccg-muted">Nothing references this {KIND_SINGULAR[item.kind]}.</p>
      ) : (
        <ul>
          {refs.map((r, n) => (
            <li key={n}>
              <button type="button" className="ccg-link" onClick={() => onSelect({ kind: 'item', key: r.from, pointer: r.pointer })}>
                {project.items[r.from]?.name ?? r.from}
              </button>{' '}
              <code className="ccg-muted">{r.pointer}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const escapePointer = (part: string) => part.replace(/~/g, '~0').replace(/\//g, '~1');

/** JSON with every value addressable by pointer, so validation can point at a field. */
export function JsonView({ value, highlight }: { value: unknown; highlight?: string | undefined }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (highlight === undefined) return;
    ref.current?.querySelector('.is-highlighted')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, value]);

  const render = (v: unknown, pointer: string, indent: string): ReactNode => {
    const mark = (node: ReactNode) => (
      <span data-pointer={pointer} className={pointer === highlight ? 'is-highlighted' : undefined}>
        {node}
      </span>
    );
    if (Array.isArray(v)) {
      if (v.length === 0) return mark('[]');
      return mark(
        <>
          {'[\n'}
          {v.map((x, i) => (
            <span key={i}>
              {indent}  {render(x, `${pointer}/${i}`, `${indent}  `)}
              {i < v.length - 1 ? ',\n' : '\n'}
            </span>
          ))}
          {indent}]
        </>,
      );
    }
    if (typeof v === 'object' && v !== null) {
      const entries = Object.entries(v);
      if (entries.length === 0) return mark('{}');
      return mark(
        <>
          {'{\n'}
          {entries.map(([k, x], i) => {
            const child = `${pointer}/${escapePointer(k)}`;
            return (
              <span key={k} className={child === highlight ? 'is-highlighted-line' : undefined}>
                {indent}  <span className="ccg-json-key">{JSON.stringify(k)}</span>: {render(x, child, `${indent}  `)}
                {i < entries.length - 1 ? ',\n' : '\n'}
              </span>
            );
          })}
          {indent}
          {'}'}
        </>,
      );
    }
    return mark(<span className={`ccg-json-${typeof v}`}>{JSON.stringify(v)}</span>);
  };

  return (
    <pre ref={ref} className="ccg-json" aria-label="Item data">
      {render(value, '', '')}
    </pre>
  );
}


/** On a ruleset: offers to move encounters onto the board when its shape changed under them (#45). */
function BoardFit({ project, run }: { project: Project; run(label: string, command: Command): string | null }) {
  const board = projectBoard(project);
  if (!board) return null;
  const off = boardIssues(project, board).filter((i) => i.message.includes('not on the board'));
  if (off.length === 0) return null;
  const positions = Object.values(project.items).flatMap((i) => (i.kind === 'encounter' ? ((i.units as { pos: string }[] | undefined) ?? []).map((u) => u.pos) : []));
  const from = guessBoard(positions);
  return (
    <div className="ccg-confirm" role="region" aria-label="Encounters off the board">
      <p>
        {off.length} encounter position{off.length === 1 ? ' is' : 's are'} off {describeBoard(board.def)}.
      </p>
      <button type="button" className="ccg-primary" onClick={() => run(`Move encounters onto ${describeBoard(board.def)}`, moveEncounters(from, board.def))}>
        Move encounters onto this board
      </button>
    </div>
  );
}
