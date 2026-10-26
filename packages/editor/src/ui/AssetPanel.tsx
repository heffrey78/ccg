/** The asset manager (#41): previews, what uses each file, import and delete. */
import { useEffect, useState } from 'react';
import { assetPathFor, assetRefs, mimeType } from '../assets.js';
import { putAsset, removeAsset, type Command } from '../commands.js';
import type { Project } from '../project.js';
import type { Selection } from './Workspace.js';

/** An object URL for an asset's bytes, revoked when it changes or unmounts. */
export function useAssetUrl(data: Uint8Array | undefined, path: string): string | null {
  // Made in the effect, not memoised: StrictMode re-runs effects, and a memoised URL would be revoked but kept.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType(path) }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [data, path]);
  return url;
}

export function AssetPreview({ project, path, size = 48 }: { project: Project; path: string; size?: number }) {
  const data = project.assets[path];
  const url = useAssetUrl(data, path);
  const type = mimeType(path);
  if (!url) return <span className="ccg-asset-missing" style={{ width: size, height: size }} aria-label="missing file" />;
  if (type.startsWith('image/')) return <img className="ccg-asset-thumb" src={url} alt="" width={size} height={size} />;
  if (type.startsWith('audio/') && size > 48) return <audio controls src={url} />;
  return <span className="ccg-asset-icon" style={{ width: size, height: size }} aria-hidden="true">{type.startsWith('audio/') ? '♪' : '▤'}</span>;
}

/** A command that imports files under assets/, never overwriting an existing one. */
export async function importAssets(project: Project, files: FileList | File[]): Promise<{ command: Command; paths: string[] }> {
  const taken = new Set(Object.keys(project.assets));
  const entries: [string, Uint8Array][] = [];
  for (const file of Array.from(files)) {
    const wanted = assetPathFor(file.name);
    const dot = wanted.lastIndexOf('.');
    const [stem, ext] = dot > wanted.lastIndexOf('/') ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ''];
    let path = wanted;
    for (let n = 2; taken.has(path); n++) path = `${stem}-${n}${ext}`;
    taken.add(path);
    entries.push([path, new Uint8Array(await file.arrayBuffer())]);
  }
  return { command: (p) => entries.reduce((acc, [path, data]) => putAsset(path, data)(acc), p), paths: entries.map(([p]) => p) };
}

export function AssetPanel({ project, path, run, onSelect }: { project: Project; path: string; run(label: string, command: Command): string | null; onSelect(s: Selection): void }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [path]);
  const data = project.assets[path];
  if (!data) return <p className="ccg-muted">This asset no longer exists.</p>;
  const uses = assetRefs(project).get(path) ?? [];
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (
    <section className="ccg-item-panel" aria-labelledby="asset-heading">
      <header className="ccg-item-header">
        <h2 id="asset-heading">{name}</h2>
        <span className="ccg-kind">asset</span>
        <span className="ccg-spacer" />
        <button type="button" className="ccg-danger" onClick={() => setConfirm(true)}>
          Delete
        </button>
      </header>
      {confirm && (
        <div className="ccg-confirm" role="alertdialog" aria-label="Confirm delete">
          <p>
            Delete {name}?{uses.length > 0 && ` ${uses.length} field${uses.length === 1 ? '' : 's'} will point at a missing file.`}
          </p>
          <button
            type="button"
            className="ccg-danger"
            onClick={() => {
              run(`Delete ${name}`, removeAsset(path));
              onSelect(null);
            }}
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
      <p className="ccg-muted">
        <code>{path}</code> · {mimeType(path)} · {(data.length / 1024).toFixed(1)} KB
      </p>
      <div className="ccg-asset-preview">
        <AssetPreview project={project} path={path} size={240} />
      </div>
      <h3>Used by</h3>
      {uses.length === 0 ? (
        <p className="ccg-muted">Nothing uses this file. Set it as a card's art, a unit's art or a status icon.</p>
      ) : (
        <ul>
          {uses.map((u, i) => (
            <li key={i}>
              <button type="button" className="ccg-link" onClick={() => onSelect({ kind: 'item', key: u.key, pointer: u.pointer })}>
                {project.items[u.key]?.name ?? u.key}
              </button>{' '}
              <code className="ccg-muted">{u.pointer}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
