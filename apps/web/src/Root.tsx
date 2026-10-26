/** The page: Play or Create. Its own module, so editing the UI hot-swaps it without restarting the engine. */
import { Suspense, lazy, useEffect, useState } from 'react';
import { App, type EngineClient } from '@ccg/client';
import { INSTALLED } from './bundled.js';
import { createPlatform } from './platform/index.js';

const platform = createPlatform();
const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? undefined;
// Play one encounter rather than the game's run, e.g. `?encounter=duel:first-fight` (handy for testing).
const encounter = params.get('encounter') ?? undefined;
// The editor is its own chunk: players never download it.
const Editor = lazy(() => import('./editor.js'));

const route = () => (location.hash.startsWith('#/create') ? 'create' : 'play');
/** `#/create/edit/<game>` opens an installed game in the editor (Play's Edit button). */
const editRequest = () => /^#\/create\/edit\/([a-z0-9_-]+)$/.exec(location.hash)?.[1];
const editable = INSTALLED.map((g) => g.id);

// The mode tabs sit above both pages, so they carry their own small stylesheet.
const MODES_CSS = `
body { margin: 0; }
.ccg-modes { display: flex; gap: 4px; align-items: center; padding: 6px 16px 0; font-family: system-ui, sans-serif; border-bottom: 1px solid #d9d4c9; background: #fbfaf7; }
.ccg-modes strong { margin-right: 12px; font-size: .95rem; }
.ccg-modes a { padding: 8px 14px; color: #1d1c1a; text-decoration: none; border-radius: 6px 6px 0 0; border: 1px solid transparent; border-bottom: none; margin-bottom: -1px; }
.ccg-modes a:hover { background: #f0ede6; }
.ccg-modes a[aria-current="page"] { background: #f6f4ef; border-color: #d9d4c9; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  .ccg-modes { background: #1c1d21; border-color: #373a41; }
  .ccg-modes a { color: #ecebe8; }
  .ccg-modes a:hover { background: #26282d; }
  .ccg-modes a[aria-current="page"] { background: #17181b; border-color: #373a41; }
}
`;

export function Root({ engine }: { engine: EngineClient }) {
  const [page, setPage] = useState(route);
  const [edit, setEdit] = useState(editRequest);
  useEffect(() => {
    const onHash = () => {
      setPage(route());
      setEdit(editRequest());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <>
      <style>{MODES_CSS}</style>
      <nav aria-label="Mode" className="ccg-modes">
        <a href="#/" aria-current={page === 'play' ? 'page' : undefined}>
          Play
        </a>
        <a href="#/create" aria-current={page === 'create' ? 'page' : undefined}>
          Editor
        </a>
      </nav>
      {page === 'create' ? (
        <div style={{ padding: 16, maxWidth: 1600, margin: '0 auto' }}>
          <Suspense fallback={<p>Loading the editor…</p>}>
            <Editor
              installed={INSTALLED}
              {...(edit && { edit })}
              onEdited={() => {
                // Forget the request, so closing the game shows the picker instead of reopening it.
                setEdit(undefined);
                if (editRequest()) history.replaceState(null, '', '#/create');
              }}
            />
          </Suspense>
        </div>
      ) : (
        <App
          engine={engine}
          platform={platform}
          editable={editable}
          onEdit={(game) => (location.hash = `#/create/edit/${game}`)}
          {...(seed !== undefined && { seed })}
          {...(encounter !== undefined && { encounter })}
        />
      )}
    </>
  );
}
