import { describe, expect, it } from 'vitest';
import type { ContentItem } from '@ccg/content';
import { blankProject, contrast, themeContrastProblems, validateProject } from '../src/index.js';

const theme = (fields: object) => ({ formatVersion: 1, kind: 'theme', id: 'look', name: 'Look', ...fields }) as ContentItem;

describe('theme contrast (#136)', () => {
  it('measures WCAG contrast ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#fff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('a readable theme, and the default look, raise nothing', () => {
    expect(themeContrastProblems(theme({}))).toEqual([]);
    expect(themeContrastProblems(theme({ colors: { page: '#120e0b', panel: '#2a221b', ink: '#f1e6d2', muted: '#b8a68a', accent: '#8a4f12' } }))).toEqual([]);
  });

  it('points at each pair below AA: panels, the table, buttons and frames', () => {
    const problems = themeContrastProblems(
      theme({
        colors: { panel: '#333333', ink: '#555555', accent: '#ffcc00' },
        table: { color: '#444444' },
        frames: [{ id: 'puff', fill: '#eeeeee', ink: '#dddddd', accent: '#ffff66' }],
      }),
    );
    expect(problems.map((p) => p.pointer)).toEqual(['/colors/ink', '/colors/muted', '/table/color', '/colors/accent', '/frames/0/ink', '/frames/0/accent']);
    expect(problems[0]?.message).toMatch(/^text contrast 1\.\d:1 is below 4\.5:1 \(WCAG AA\): text on panels$/);
  });

  it('shows up in validation as warnings, not errors', async () => {
    const blank = blankProject({ id: 'look', name: 'Look', board: 'lane' });
    const project = { ...blank, items: { ...blank.items, 'theme:dim': theme({ id: 'dim', colors: { ink: '#cccccc' } }) }, paths: { ...blank.paths, 'theme:dim': 'content/themes/dim.json' } };
    const issues = (await validateProject(project)).filter((i) => i.key === 'theme:dim');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});
