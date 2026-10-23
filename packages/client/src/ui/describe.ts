import type { Action, GameEvent } from '@ccg/core';

const COMPASS: Record<string, string> = { n: 'north', ne: 'north-east', e: 'east', se: 'south-east', s: 'south', sw: 'south-west', w: 'west', nw: 'north-west' };

/** A direction as a player reads it: forward/back on a lane, compass points elsewhere. */
export function directionLabel(dir: string, topology?: string): string {
  if (topology === 'lane') return dir === 'e' ? 'forward' : dir === 'w' ? 'back' : dir;
  return COMPASS[dir] ?? dir;
}

/** A readable label for an action, for buttons and screen readers. */
export function describeAction(action: Action, names: Record<string, string>, cardDefs: Record<string, string>, topology?: string): string {
  const name = (id: unknown) => (typeof id !== 'string' ? '' : (names[id] ?? (id in COMPASS ? directionLabel(id, topology) : id)));
  const target = action.target === undefined ? '' : ` → ${name(action.target)}`;
  switch (action.type) {
    case 'playCard':
      return `Play ${name(cardDefs[action.card as string] ?? action.card)}${target}`;
    case 'endTurn':
      return 'End turn';
    case 'pass':
      return 'Pass';
    case 'move':
      return `Move ${name(action.unit)} to ${String(action.to)}`;
    case 'activate':
      return `Activate ${name(action.permanent)}${target}`;
    default:
      return action.type;
  }
}

export interface EventContext {
  side: string;
  /** Unit id → definition id, for units the viewer has seen. */
  unitDefs: Record<string, string>;
  /** Card instance id → definition id, for cards the viewer can see. */
  cardDefs: Record<string, string>;
  /** Unit id → declared intent name. */
  intentNames: Record<string, string>;
  names: Record<string, string>;
}

/** A short line for an event, for the log and the play-by-play banner; null for bookkeeping events. */
export function describeEvent(e: GameEvent, ctx: EventContext): string | null {
  const name = (id: string | undefined) => (id === undefined ? '?' : (ctx.names[id] ?? id));
  const unit = (id: unknown) => (typeof id === 'string' ? name(ctx.unitDefs[id] ?? id) : 'Something');
  const who = (side: unknown) => (side === ctx.side ? 'You' : 'Enemy');
  switch (e.type) {
    case 'ItemAnnounced': {
      if (e.kind === 'hidden' || e.secret) return `${who(e.controller)} played a face-down card`;
      const card = typeof e.source === 'string' ? ctx.cardDefs[e.source] : undefined;
      if (card) return `${who(e.controller)} played ${name(card)}`;
      if (e.kind === 'intent') return `${unit(e.source)}: ${ctx.intentNames[e.source as string] ?? 'acts'}`;
      return null;
    }
    case 'CardRevealed':
      return `Revealed ${name(e.def as string)}`;
    case 'DamageDealt':
      return `${unit(e.unit)} takes ${String(e.amount)} damage`;
    case 'AttackBlocked':
      return `${unit(e.unit)} blocks the hit`;
    case 'BlockGained':
      return `${unit(e.unit)} gains ${String(e.amount)} block`;
    case 'Healed':
      return `${unit(e.unit)} heals ${String(e.amount)}`;
    case 'StatusChanged':
      return `${unit(e.unit)}: ${name(e.status as string)} ${String(e.stacks)}`;
    case 'StatusRemoved':
      return `${unit(e.unit)} loses ${name(e.status as string)}`;
    case 'UnitEnteredTile':
      return e.movement === 'swap' ? null : `${unit(e.unit)} moves to ${String(e.pos)}`;
    case 'UnitCollided':
      return `${unit(e.unit)} collides`;
    case 'UnitSpawned':
      return `${name(e.def as string)} enters`;
    case 'UnitDied':
      return `${unit(e.unit)} is defeated`;
    case 'UnitFell':
      return `${unit(e.unit)} falls`;
    case 'IntentDeclared':
      return `${unit(e.unit)} intends ${typeof e.name === 'string' ? e.name : 'something'}`;
    case 'PermanentEntered':
      return `A permanent enters play`;
    case 'PermanentRevealed':
      return `A hidden permanent is revealed`;
    case 'ItemCountered':
      return 'Countered';
    case 'RoundStarted':
      return `Round ${String(e.round)}`;
    case 'GameEnded':
      return 'Game over';
    default:
      return null;
  }
}
