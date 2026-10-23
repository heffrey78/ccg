import { useMemo, useState } from 'react';
import { CONTENT_KINDS, type ContentKind } from '@ccg/content';
import { itemsOfKind, type Project } from '../project.js';
import { slug } from './ProjectPicker.js';
import type { Selection } from './Workspace.js';

const KIND_LABELS: Record<ContentKind, string> = { card: 'Cards', unit: 'Units', status: 'Statuses', tile: 'Tiles', encounter: 'Encounters', ruleset: 'Rulesets' };
export const KIND_SINGULAR: Record<ContentKind, string> = { card: 'card', unit: 'unit', status: 'status', tile: 'tile', encounter: 'encounter', ruleset: 'ruleset' };

export interface BrowserProps {
  project: Project;
  selection: Selection;
  /** Item keys with validation issues. */
  issues: Set<string>;
  onSelect(selection: Selection): void;
  /** Creates an item; returns an error message, or null on success. */
  onCreate(kind: ContentKind, id: string, name: string): string | null;
}

/** The content tree: items by kind, filtered by a search and tags. */
export function Browser({ project, selection, issues, onSelect, onCreate }: BrowserProps) {
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<ContentKind | null>(null);

  const allTags = useMemo(() => [...new Set(Object.values(project.items).flatMap((i) => (i.tags as string[] | undefined) ?? []))].sort(), [project]);
  const q = query.trim().toLowerCase();
  const matches = (item: { id: string; name: string; tags?: unknown }) => {
    const itemTags = (item.tags as string[] | undefined) ?? [];
    if ([...tags].some((t) => !itemTags.includes(t))) return false;
    return q === '' || item.name.toLowerCase().includes(q) || item.id.includes(q) || itemTags.some((t) => t.toLowerCase().includes(q));
  };

  return (
    <nav className="ccg-browser" aria-label="Content">
      <input type="search" placeholder="Search content" aria-label="Search content" value={query} onChange={(e) => setQuery(e.target.value)} />
      {allTags.length > 0 && (
        <div className="ccg-tags" role="group" aria-label="Filter by tag">
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              className="ccg-tag"
              aria-pressed={tags.has(t)}
              onClick={() => setTags((s) => (s.has(t) ? new Set([...s].filter((x) => x !== t)) : new Set([...s, t])))}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <button type="button" className={`ccg-tree-item ${selection?.kind === 'manifest' ? 'is-selected' : ''}`} onClick={() => onSelect({ kind: 'manifest' })}>
        Game settings
      </button>
      {CONTENT_KINDS.map((kind) => {
        const items = itemsOfKind(project, kind).filter(([, item]) => matches(item));
        return (
          <details key={kind} open>
            <summary>
              {KIND_LABELS[kind]} <span className="ccg-muted">{items.length}</span>
              <button type="button" className="ccg-add" aria-label={`New ${KIND_SINGULAR[kind]}`} onClick={(e) => (e.preventDefault(), setAdding(kind))}>
                +
              </button>
            </summary>
            {adding === kind && (
              <NewItemForm
                kind={kind}
                onCancel={() => setAdding(null)}
                onCreate={(id, name) => {
                  const error = onCreate(kind, id, name);
                  if (!error) setAdding(null);
                  return error;
                }}
              />
            )}
            <ul>
              {items.map(([key, item]) => (
                <li key={key}>
                  <button
                    type="button"
                    className={`ccg-tree-item ${selection?.kind === 'item' && selection.key === key ? 'is-selected' : ''}`}
                    aria-current={selection?.kind === 'item' && selection.key === key ? 'true' : undefined}
                    onClick={() => onSelect({ kind: 'item', key })}
                  >
                    {item.name} <span className="ccg-muted">{item.id}</span>
                    {issues.has(key) && <span className="ccg-issue-dot" aria-label="has problems" />}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </nav>
  );
}

function NewItemForm({ kind, onCreate, onCancel }: { kind: ContentKind; onCreate(id: string, name: string): string | null; onCancel(): void }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownId = touched ? id : slug(name);
  return (
    <form
      className="ccg-new-item"
      aria-label={`New ${KIND_SINGULAR[kind]}`}
      onSubmit={(e) => {
        e.preventDefault();
        setError(onCreate(shownId, name.trim() || shownId));
      }}
    >
      <label>
        Name <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Id{' '}
        <input
          value={shownId}
          onChange={(e) => {
            setTouched(true);
            setId(e.target.value);
          }}
        />
      </label>
      {error && <p role="alert" className="ccg-error">{error}</p>}
      <div className="ccg-row">
        <button type="submit" className="ccg-primary">
          Add
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
