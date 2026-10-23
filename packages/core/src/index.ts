/**
 * Version of the engine API that game packages declare compatibility with
 * (see decision #14). Bumped independently of the npm package version.
 */
export const ENGINE_API_VERSION = '0.0.0';

export { canonicalJson, hashState } from './hash.js';
export { Rng, seedRng, type RngState } from './rng.js';
export { END_TURN, apply, createGame, legalActions, schedule, type ScheduledPhase } from './kernel/engine.js';
export { ContentError, isVarRef } from './kernel/params.js';
export type * from './kernel/types.js';
