/// <reference lib="webworker" />
// The editor's playtest engine: no bundled games; it runs whatever project the editor sends.
import { createEngineHost, serveEngine } from '@ccg/client/engine';

serveEngine(createEngineHost(), self as unknown as DedicatedWorkerGlobalScope);
