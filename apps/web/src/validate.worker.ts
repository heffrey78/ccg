/// <reference lib="webworker" />
// Editor validation runs here so typing never waits on schema checks.
import { validateProject, type Project } from '@ccg/editor';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener('message', (event: MessageEvent<{ id: number; project: Project }>) => {
  const { id, project } = event.data;
  void validateProject(project).then(
    (issues) => scope.postMessage({ id, issues }),
    (error: unknown) => scope.postMessage({ id, issues: [{ file: '', pointer: '', message: `validation failed: ${String(error)}` }] }),
  );
});
