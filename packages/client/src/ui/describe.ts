import type { Action } from '@ccg/core';

/** A readable label for an action, for buttons and screen readers. */
export function describeAction(action: Action, names: Record<string, string>, cardDefs: Record<string, string>): string {
  const name = (id: unknown) => (typeof id === 'string' ? (names[id] ?? id) : '');
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
