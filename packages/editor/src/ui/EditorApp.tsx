/** The editor's top level: pick or create a project, then edit it. */
import { useMemo, useState } from 'react';
import type { OpRegistry } from '@ccg/content';
import type { Project } from '../project.js';
import type { DirectoryHandleLike } from '../stores/fsa.js';
import type { ProjectLibrary } from '../stores/indexeddb.js';
import { editorOps, validateProject, type ProjectIssue } from '../validate.js';
import { ProjectPicker } from './ProjectPicker.js';
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
}

export function EditorApp({ library, pickDirectory, validate, ops }: EditorAppProps) {
  const [session, setSession] = useState<Session | null>(null);
  const registry = useMemo(() => ops ?? editorOps(), [ops]);
  const check = useMemo(() => validate ?? ((p: Project) => validateProject(p, registry)), [validate, registry]);
  return (
    <div className="ccg-editor">
      <style>{CSS}</style>
      {session ? (
        <Workspace key={session.id} session={session} ops={registry} validate={check} onClose={() => setSession(null)} />
      ) : (
        <ProjectPicker library={library} {...(pickDirectory && { pickDirectory })} onOpen={setSession} />
      )}
    </div>
  );
}
