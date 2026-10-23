export { ENGINE_API_VERSION, isEngineCompatible } from './version.js';
export {
  REPLAY_FORMAT,
  SNAPSHOT_FORMAT,
  Session,
  parseSnapshot,
  replay,
  serializeSnapshot,
  type ReplayLog,
  type ReplayResult,
  type Snapshot,
} from './replay.js';
export { canonicalJson, hashState } from './hash.js';
export { Rng, seedRng, type RngState } from './rng.js';
export { END_TURN, apply, createGame, legalActions, schedule, type ScheduledPhase } from './kernel/engine.js';
export { ContentError, isVarRef } from './kernel/params.js';
export type * from './kernel/types.js';
export { HexTopology } from './board/hex.js';
export { LaneTopology } from './board/lane.js';
export { SquareTopology, type SquareOptions } from './board/square.js';
export {
  BaseTopology,
  findPath,
  lineOfSight,
  type Dir,
  type PatternShape,
  type Pos,
  type Topology,
} from './board/topology.js';
export {
  composeRules,
  defineOp,
  describeOps,
  type BaseRules,
  type ModuleOp,
  type OpDefinition,
  type RulesModule,
} from './rules/compose.js';
export {
  ZONES,
  canAfford,
  createCardsState,
  effectiveDef,
  locateCard,
  zone,
  zonesModule,
  type CardDef,
  type CardInstance,
  type CardLocation,
  type CardsSetupOptions,
  type CardsState,
  type CardsWorld,
  type TargetingResolver,
  type ZonesOptions,
} from './cards/zones.js';
export {
  boardModule,
  boardTargeting,
  createBoardState,
  unitAt,
  type BoardConfig,
  type BoardState,
  type BoardTargetingOptions,
  type BoardWorld,
  type MoveActionConfig,
  type TileDef,
  type UnitDef,
  type UnitPlacement,
  type UnitState,
} from './board/units.js';
export { builtinOps } from './builtins.js';
export {
  cardText,
  conditionText,
  directionText,
  effectsText,
  patternText,
  targetingText,
  type TextOptions,
} from './cards/text.js';
export { condition, evaluate, logicModule, type Condition } from './rules/logic.js';
export { statusesModule, type DamageModifier, type StatusDef, type StatusHook } from './board/statuses.js';
export { buildDefinitions, type Definitions } from './content.js';
export { isGamePackage, qualify, type AssetResolver, type GamePackage } from './packages/package.js';
export { PackageRegistry, type PackageIssue, type ResolveResult, type ResolvedGame } from './packages/registry.js';
export { parseVersion, satisfies } from './packages/semver.js';
