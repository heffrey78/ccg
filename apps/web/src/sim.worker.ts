/// <reference lib="webworker" />
// Balance simulations: each worker plays its share of the seeds.
import { simulateProject, type Project } from '@ccg/editor';
import type { SimOptions } from '@ccg/core';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener('message', (event: MessageEvent<{ id: number; project: Project; options: SimOptions }>) => {
  const { id, project, options } = event.data;
  simulateProject(project, options).then(
    (records) => scope.postMessage({ id, records }),
    (error: unknown) => scope.postMessage({ id, error: String(error) }),
  );
});
