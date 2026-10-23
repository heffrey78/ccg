/** The engine side of the client, without React: safe to import in a Web Worker. */
export { EngineClient, EngineError, localTransport, serveEngine, workerTransport, type EngineTransport } from './client.js';
export { createEngineHost, type EngineHost, type HostOptions } from './host.js';
export type { EngineReply, EngineRequest, GameListing, Snapshot } from './protocol.js';
