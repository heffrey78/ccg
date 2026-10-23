import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@ccg/content';
import { behaviorSummary, blankProject, createItem, editorOps, previewIntents } from '../src/index.js';

const ops = editorOps();
const hit = (name: string, damage: number, range = 1) => ({
  kind: 'intent',
  intent: { name, target: { kind: 'unit', select: 'nearestEnemy', range }, effects: [{ op: 'damage', amount: damage }] },
});

describe('behaviour preview', () => {
  it('a conditional behaviour previews correctly at two positions', () => {
    // The template's foe: if an enemy is within 1, Hit; otherwise Advance.
    const project = blankProject({ id: 'b', name: 'B', board: 'grid' });
    const adjacent = previewIntents(project, ops, 'unit:foe', 'square', '5,4', 1);
    expect(adjacent.rounds).toEqual([{ round: 1, name: 'Hit', text: 'Deal 5 damage.', cells: ['5,4'] }]);
    const far = previewIntents(project, ops, 'unit:foe', 'square', '1,4', 1);
    expect(far.rounds.map((r) => [r.name, r.cells])).toEqual([['Advance', ['1,4']]]);
    expect(behaviorSummary(project.items['unit:foe']?.behavior as never)).toBe('If an enemy is within 1: Hit; otherwise: Advance');
  });

  it('a three-step pattern fires its intents in order, round after round', () => {
    let project = blankProject({ id: 'b', name: 'B', board: 'lane' });
    project = createItem({
      formatVersion: 1,
      kind: 'unit',
      id: 'drummer',
      name: 'Drummer',
      hp: 30,
      behavior: { kind: 'sequence', steps: [hit('Jab', 2, 9), hit('Slam', 6, 9), { kind: 'intent', intent: { name: 'Rest', target: { kind: 'self' }, effects: [{ op: 'gainBlock', amount: 3 }] } }] },
    } as ContentItem)(project);
    const preview = previewIntents(project, ops, 'unit:drummer', 'lane', '1', 5);
    expect(preview.error).toBeUndefined();
    expect(preview.rounds.map((r) => r.name)).toEqual(['Jab', 'Slam', 'Rest', 'Jab', 'Slam']);
    expect(preview.rounds[1]).toMatchObject({ text: 'Deal 6 damage.', cells: ['1'] });
    expect(preview.rounds[2]?.cells).toEqual(['4']);
    expect(behaviorSummary(project.items['unit:drummer']?.behavior as never)).toBe('In turn: Jab → Slam → Rest, then repeat');
  });

  it('a unit without behaviour previews nothing', () => {
    const project = blankProject({ id: 'b', name: 'B', board: 'lane' });
    expect(previewIntents(project, ops, 'unit:hero', 'lane', '1')).toMatchObject({ rounds: [] });
    expect(behaviorSummary(undefined)).toBe('No behaviour: it never acts.');
  });
});
