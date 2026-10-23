import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContentItem, Manifest, OpRegistry } from '@ccg/content';
import { deleteItem, duplicateItem, referencesTo, renameItem, updateItem, updateManifest, type Command } from '../commands.js';
import type { Project } from '../project.js';
import type { ProjectIssue } from '../validate.js';
import { KIND_SINGULAR } from './Browser.js';
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

export function ManifestPanel({ project, run }: Pick<PanelProps, 'project' | 'run'>) {
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
    </section>
  );
}

export function ItemPanel({ project, ops, issues, run, onSelect, itemKey, pointer }: PanelProps & { itemKey: string; pointer?: string | undefined }) {
  const item = project.items[itemKey];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setConfirmDelete(false);
    setError(null);
  }, [itemKey]);
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

      <div className="ccg-fields">
        <Field label="Name" value={item.name} onCommit={(name) => update(`Rename ${item.name} to ${name}`, { name })} />
        <Field
          label="Id"
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
            <li key={n}>
              <button type="button" onClick={() => onSelect({ kind: 'item', key: itemKey, pointer: i.pointer })}>
                <code>{i.pointer || '/'}</code> {i.message}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Data</h3>
      <p className="ccg-muted">Field editors arrive with the card, unit and encounter editors; this view is read-only.</p>
      <JsonView value={item} highlight={pointer} />

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

