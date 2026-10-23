/** The engine side of the client, without React: safe to import in a Web Worker. */
export { EngineClient, EngineError, localTransport, serveEngine, workerTransport, type EngineTransport } from './client.js';
export { createEngineHost, type EngineHost, type HostOptions } from './host.js';
export type { CardFace, Catalog, EngineReply, EngineRequest, GameListing, IntentSummary, Snapshot } from './protocol.js';
export { cardFace, type FaceOptions } from './faces.js';
