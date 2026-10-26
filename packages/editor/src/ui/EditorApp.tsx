/** The editor's top level: pick or create a project, then edit it. */
import { useMemo, useState } from 'react';
import type { OpRegistry } from '@ccg/content';
import { CSS as CLIENT_CSS } from '@ccg/client';
import { EngineClient, createEngineHost, localTransport } from '@ccg/client/engine';
import type { Project } from '../project.js';
import type { DirectoryHandleLike } from '../stores/fsa.js';
import type { ProjectLibrary } from '../stores/indexeddb.js';
import { editorOps, simulateProject, validateProject, type ProjectIssue } from '../validate.js';
import type { Simulator } from './BalancePanel.js';
import { ProjectPicker, type InstalledGame } from './ProjectPicker.js';
import type { Session } from './session.js';
import { CSS } from './styles.js';
import { Workspace } from './Workspace.js';

export interface EditorAppProps {
  /** Where browser projects are kept; null when IndexedDB is unavailable (projects then live in memory). */
  library: ProjectLibrary | null;
  /** Folder picker for editing a package on disk (Chromium's `showDirectoryPicker`). */
  pickDirectory?: () => Promise<DirectoryHandleLike | null>;
  /** Validation, e.g. in a worker. Defaults to validating on the main thread. */
  validate?: (project: Project) => Promise<ProjectIssue[]>;
  ops?: OpRegistry;
  /** The engine for playtests, e.g. in a worker. Defaults to one running in this thread. */
  playtestEngine?: EngineClient;
  /** Balance simulations, e.g. over a worker pool. Defaults to this thread. */
  simulate?: Simulator;
  /** Games the host ships, offered for editing as browser copies. */
  installed?: InstalledGame[];
  /** An installed game to open straight away (e.g. from Play's Edit button). */
  edit?: string;
  /** Called once the requested game is open, so the host can forget the request. */
  onEdited?(): void;
}

export function EditorApp({ library, pickDirectory, validate, ops, playtestEngine, simulate, installed, edit, onEdited }: EditorAppProps) {
  const [session, setSession] = useState<Session | null>(null);
  const engine = useMemo(() => playtestEngine ?? new EngineClient(localTransport(createEngineHost({ debug: true }))), [playtestEngine]);
  const registry = useMemo(() => ops ?? editorOps(), [ops]);
  const check = useMemo(() => validate ?? ((p: Project) => validateProject(p, registry)), [validate, registry]);
  return (
    <div className="ccg-editor">
      <style>{CLIENT_CSS}</style>
      <style>{CSS}</style>
      {session ? (
        <Workspace key={session.id} session={session} ops={registry} validate={check} playtestEngine={engine} simulate={simulate ?? ((p, o) => simulateProject(p, o))} onClose={() => setSession(null)} />
      ) : (
        <ProjectPicker
          library={library}
          {...(pickDirectory && { pickDirectory })}
          {...(installed && { installed })}
          {...(edit && { edit })}
          onOpen={(s) => {
            setSession(s);
            onEdited?.();
          }}
        />
      )}
    </div>
  );
}
