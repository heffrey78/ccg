/**
 * The parts of a view's world the encounter screen draws. The client never
 * imports game packages, so it reads the engine modules' world slices
 * structurally; a game without a slice just doesn't show that part.
 */
import type { BoardPresentation } from '@ccg/core';

export type Layout = BoardPresentation;

export interface UnitView {
  id: string;
  def: string;
  side: string;
  pos: string;
  facing: string;
  hp: number;
  maxHp: number;
  block: number;
  statuses: Record<string, number>;
  createdAt?: number;
  passable?: boolean;
}

export interface BoardView {
  units: Record<string, UnitView>;
  tiles: Record<string, string>;
  /** Under fog of war: the tiles the viewer can see. */
  vision?: string[];
}

export interface CardsView {
  /** Only cards the viewer can see have an instance. */
  instances: Record<string, { def: string; upgraded?: boolean }>;
  zones: Record<string, Record<string, string[]>>;
  resources: Record<string, Record<string, number>>;
}

export interface IntentView {
  id: string;
  unit: string;
  side: string;
  name?: string;
  icon?: string;
  bound?: 'unit' | 'tile' | 'none';
  target?: string;
  cells?: string[];
  visibility: 'full' | 'partial' | 'hidden';
}

export interface PermanentView {
  id: string;
  kind: string;
  card: string;
  controller: string;
  unit?: string;
  pos?: string;
  turnsLeft?: number;
}

export interface WorldView {
  board?: BoardView;
  cards?: CardsView;
  intents?: { declared: IntentView[] };
  permanents?: Record<string, PermanentView>;
}

export function layoutOf(presentation: Record<string, unknown>): Layout | null {
  const board = presentation.board as Layout | undefined;
  return board && Array.isArray(board.cells) ? board : null;
}

/** The permanent whose board unit this is, if any. */
export function permanentOfUnit(world: WorldView, unit: string): PermanentView | undefined {
  return Object.values(world.permanents ?? {}).find((p) => p.unit === unit);
}
