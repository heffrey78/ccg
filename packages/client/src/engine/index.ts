/** The engine side of the client, without React: safe to import in a Web Worker. */
export { EngineClient, EngineError, localTransport, serveEngine, workerTransport, type EngineTransport } from './client.js';
export { createEngineHost, type EngineHost, type HostOptions } from './host.js';
export type { CardFace, Catalog, DebugInfo, EngineReply, EngineRequest, GameListing, IntentSummary, RunProgress, SaveGame, ServiceChoice, Snapshot, Theme, ThemeFont, ThemeFrame } from './protocol.js';
export { cardFace, type FaceOptions } from './faces.js';
export { frameFor, resolveTheme } from './theme.js';
