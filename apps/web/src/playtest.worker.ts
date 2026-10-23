/// <reference lib="webworker" />
// The editor's playtest engine: no bundled games; it runs whatever project the editor sends.
import { createEngineHost, serveEngine } from '@ccg/client/engine';

// Debugging reveals everything; that's the point in an editor, never in the play client.
serveEngine(createEngineHost({ debug: true }), self as unknown as DedicatedWorkerGlobalScope);
