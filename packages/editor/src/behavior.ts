/**
 * Enemy behaviour authoring (#44): readable summaries of behaviour trees, and
 * a preview that runs the real engine on a small board, so what the editor
 * shows is exactly what the unit will telegraph in play.
 */
import type { OpRegistry, ContentItem } from '@ccg/content';
import {
  buildDefinitions,
  createBoardState,
  createCardsState,
  createGame,
  createIntentsState,
  apply,
  effectsText,
  standardRules,
  type Behavior,
  type BehaviorCondition,
  type DeclaredIntent,
  type GameState,
  type RulesetDef,
  type StandardWorld,
} from '@ccg/core';
import { previewSetup, type PreviewBoard } from './forms/patterns.js';
import type { Project } from './project.js';

export function conditionSummary(cond: BehaviorCondition): string {
  switch (cond.kind) {
    case 'always':
      return 'always';
    case 'enemyWithin':
      return `an enemy is within ${cond.range}`;
    case 'hpAtMost':
      return `its HP is at most ${Math.round(cond.fraction * 100)}%`;
    case 'not':
      return `not (${conditionSummary(cond.cond)})`;
    case 'all':
      return cond.of.map(conditionSummary).join(' and ') || 'always';
    case 'any':
      return cond.of.map(conditionSummary).join(' or ') || 'never';
  }
}

/** One line for a behaviour tree, e.g. "If an enemy is within 1: Hit; otherwise: Advance". */
export function behaviorSummary(node: Behavior | undefined): string {
  if (!node) return 'No behaviour: it never acts.';
  switch (node.kind) {
    case 'intent':
      return node.intent.name;
    case 'sequence':
      return `In turn: ${node.steps.map(behaviorSummary).join(' → ')}, then repeat`;
    case 'weighted': {
      const total = node.options.reduce((n, o) => n + o.weight, 0) || 1;
      return `At random: ${node.options.map((o) => `${behaviorSummary(o.then)} (${Math.round((o.weight / total) * 100)}%)`).join(', ')}`;
    }
    case 'if':
      return `If ${conditionSummary(node.cond)}: ${behaviorSummary(node.then)}; otherwise: ${behaviorSummary(node.else)}`;
  }
}

export interface PreviewRound {
  round: number;
  name: string;
  /** What the intent does, as card text. */
  text: string;
  /** Tiles it telegraphs: its pattern, its tile, or its target unit's tile. */
  cells: string[];
}

export interface IntentPreviewResult {
  board: PreviewBoard;
  enemyPos: string;
  playerPos: string;
  rounds: PreviewRound[];
  /** Why the preview stopped early, if it did. */
  error?: string;
}

const RULESET_BOARDS: Record<PreviewBoard, RulesetDef['board']> = {
  lane: { topology: 'lane', length: 9 },
  square: { topology: 'square', width: 9, height: 9, connectivity: 8 },
  hex: { topology: 'hex', radius: 4 },
};
const TARGET_DUMMY = 'preview-target';

/**
 * Plays a few rounds with the unit at the board's centre and a target dummy
 * at `playerPos`, recording what it declares each round. Its intents resolve
 * between rounds (it may move or hit the dummy), as in a real game.
 */
export function previewIntents(project: Project, ops: OpRegistry, unitKey: string, board: PreviewBoard, playerPos: string, rounds = 3): IntentPreviewResult {
  const setup = previewSetup(board);
  const out: IntentPreviewResult = { board, enemyPos: setup.origin, playerPos, rounds: [] };
  const unit = project.items[unitKey];
  if (!unit || unit.kind !== 'unit') return { ...out, error: 'not a unit' };
  try {
    const definitions = buildDefinitions(Object.values(project.items) as ContentItem[]);
    definitions.units[TARGET_DUMMY] = { hp: 999 };
    const ruleset: RulesetDef = { board: RULESET_BOARDS[board], player: { resources: {}, handSize: 0, deck: [] } };
    const rules = standardRules(ruleset, { definitions, encounters: [] });
    const created = createGame<StandardWorld>(rules, {
      seed: 'preview',
      sides: [
        { id: 'player', controller: 'human' },
        { id: 'enemy', controller: 'ai' },
      ],
      world: {
        board: createBoardState(definitions.units, [
          { id: 'it', def: unit.id, side: 'enemy', pos: setup.origin, facing: 'w' },
          { id: 'target', def: TARGET_DUMMY, side: 'player', pos: playerPos, facing: 'e' },
        ]),
        cards: createCardsState({ player: [], enemy: [] }),
        intents: createIntentsState(),
        permanents: {},
      },
    });
    if (!created.ok) return { ...out, error: created.error.message };
    let state: GameState<StandardWorld> = created.state;
    for (let round = 1; round <= rounds; round++) {
      const intent = state.world.intents.declared.find((i) => i.unit === 'it');
      if (!intent) break;
      out.rounds.push({ round, name: intent.name, text: effectsText(intent.effects, ops, { topology: board }), cells: telegraph(state, intent) });
      if (round === rounds || state.outcome) break;
      const next = apply(rules, state, { type: 'endTurn', side: 'player' });
      if (!next.ok) return { ...out, error: next.error.message };
      state = next.state;
    }
    return out;
  } catch (error) {
    return { ...out, error: (error as Error).message };
  }
}

function telegraph(state: GameState<StandardWorld>, intent: DeclaredIntent): string[] {
  if (intent.cells && intent.cells.length > 0) return intent.cells;
  if (intent.bound === 'tile' && intent.target) return [intent.target];
  if (intent.bound === 'unit' && intent.target) {
    const pos = state.world.board.units[intent.target]?.pos;
    return pos ? [pos] : [];
  }
  return [];
}
