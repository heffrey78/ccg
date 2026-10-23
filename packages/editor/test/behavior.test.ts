import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@ccg/content';
import { behaviorSummary, blankProject, createItem, editorOps, moveEncounters, previewIntents, testProject, updateItem, validateProject } from '../src/index.js';
import { changedPointers } from '../src/ui/DebugPanel.js';
import { testScenario } from '../src/ui/PlaytestPane.js';

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

describe('encounters on the board', () => {
  const setBoard = (project: ReturnType<typeof blankProject>, board: object) => updateItem('ruleset:main', { ...(project.items['ruleset:main'] as ContentItem), board } as ContentItem)(project);

  it('flags positions off the ruleset board and units sharing a tile', async () => {
    let project = blankProject({ id: 'b', name: 'B', board: 'lane' });
    expect(await validateProject(project)).toEqual([]);
    project = setBoard(project, { topology: 'lane', length: 5 });
    const issues = await validateProject(project);
    expect(issues).toEqual([
      { file: 'content/encounters/first-fight.json', key: 'encounter:first-fight', pointer: '/units/1/pos', message: "'6' is not on the board (a lane of 5)" },
    ]);
    const crowded = updateItem('encounter:first-fight', {
      ...(project.items['encounter:first-fight'] as ContentItem),
      units: [
        { unit: 'hero', side: 'player', pos: '1' },
        { unit: 'foe', side: 'enemy', pos: '1' },
      ],
    } as ContentItem)(project);
    expect((await validateProject(crowded)).map((i) => i.message)).toEqual(["two units start on '1' (see unit 1)"]);
  });

  it('switching lane → square moves encounters onto the middle row, and back', async () => {
    let project = setBoard(blankProject({ id: 'b', name: 'B', board: 'lane' }), { topology: 'square', width: 7, height: 7 });
    expect((await validateProject(project)).map((i) => i.pointer)).toEqual(['/units/0/pos', '/units/1/pos']);
    project = moveEncounters('lane', { topology: 'square', width: 7, height: 7 })(project);
    expect((project.items['encounter:first-fight'] as unknown as { units: { pos: string }[] }).units.map((u) => u.pos)).toEqual(['0,3', '6,3']);
    expect(await validateProject(project)).toEqual([]);
    project = setBoard(project, { topology: 'lane', length: 7 });
    project = moveEncounters('square', { topology: 'lane', length: 7 })(project);
    expect((project.items['encounter:first-fight'] as unknown as { units: { pos: string }[] }).units.map((u) => u.pos)).toEqual(['0', '6']);
  });
});

describe('scenario tests in the editor', () => {
  it('runs the project’s scenarios with expectations', async () => {
    let project = blankProject({ id: 't', name: 'T', board: 'lane' });
    project = createItem({ formatVersion: 1, kind: 'scenario', id: 'calm', name: 'Calm', encounter: 'first-fight', seed: 1, expect: [{ kind: 'outcome', winner: 'none' }] } as ContentItem)(project);
    project = createItem({ formatVersion: 1, kind: 'scenario', id: 'won', name: 'Won already?', encounter: 'first-fight', seed: 1, expect: [{ kind: 'outcome', winner: 'player' }] } as ContentItem)(project);
    expect((await testProject(project)).map((r) => [r.id, r.passed, r.failures])).toEqual([
      ['t:calm', true, []],
      ['t:won', false, ['expected the player to win, but it goes on']],
    ]);
  });
});

describe('debugger helpers', () => {
  it('finds what changed between two states, with the parents of each change', () => {
    const before = { turn: { round: 1, phase: 'a' }, world: { units: { a: { hp: 5 }, b: { hp: 3 } } }, log: [1] };
    const after = { turn: { round: 2, phase: 'a' }, world: { units: { a: { hp: 5 }, b: { hp: 1 } } }, log: [1, 2] };
    expect([...changedPointers(before, after)].sort()).toEqual(['', '/log', '/log/1', '/turn', '/turn/round', '/world', '/world/units', '/world/units/b', '/world/units/b/hp']);
    expect(changedPointers(before, structuredClone(before)).size).toBe(0);
  });

  it('a test saved from a playtest replays to the same result', async () => {
    let project = blankProject({ id: 'dbg', name: 'Dbg', board: 'lane' });
    const state = { outcome: null, sides: [{ id: 'player' }, { id: 'enemy' }], world: { board: { units: { a: { def: 'dbg:hero', side: 'player', hp: 30 }, b: { def: 'dbg:foe', side: 'enemy', hp: 20 } } } } };
    const item = testScenario(project, { encounter: 'dbg:first-fight', seed: 3 }, [{ type: 'endTurn', side: 'player' }], state as never);
    expect(item).toMatchObject({ kind: 'scenario', id: 'first-fight-test', encounter: 'first-fight', seed: 3, actions: [{ type: 'endTurn', side: 'player' }] });
    expect((item as unknown as { expect: object[] }).expect).toEqual([
      { kind: 'outcome', winner: 'none' },
      { kind: 'unit', unit: 'hero', side: 'player', hp: { min: 30, max: 30 } },
      { kind: 'unit', unit: 'foe', side: 'enemy', hp: { min: 20, max: 20 } },
    ]);
    project = createItem(item)(project);
    // After one end turn the foe has advanced but not reached the hero, so nothing is hurt.
    expect((await testProject(project)).map((r) => [r.id, r.passed, r.failures])).toEqual([['dbg:first-fight-test', true, []]]);
  });
});
