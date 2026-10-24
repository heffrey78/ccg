import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { filesSource, type ContentItem } from '@ccg/content';
import { PackageRegistry, runMapDepths, runMapOf, runScenarios, simulate, simulateRun, summarize, type ResolvedGame, type RulesetDef } from '@ccg/core';
import { openProject, projectFiles, validateProject, type Files } from '@ccg/editor';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readGame(): Files {
  const files: Files = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = relative(ROOT, path).split(sep).join('/');
      if (statSync(path).isDirectory()) {
        if (!['node_modules', 'test'].includes(name)) walk(path);
      } else if (rel === 'game.json' || rel.startsWith('content/') || rel.startsWith('assets/')) files[rel] = new Uint8Array(readFileSync(path));
    }
  };
  walk(ROOT);
  return files;
}

let game: ResolvedGame<unknown>;
let items: ContentItem[];
beforeAll(async () => {
  const registry = new PackageRegistry();
  const loaded = await registry.loadFiles(filesSource(readGame()));
  if (!loaded.ok) throw new Error(loaded.issues.map((i) => `${i.file}${i.pointer}: ${i.message}`).join('\n'));
  const resolved = registry.resolve('sporeline');
  if (!resolved.ok) throw new Error(resolved.issues.map((i) => i.message).join('\n'));
  game = resolved.game;
  items = game.items;
});

describe('Sporeline content', () => {
  it('is exactly what the editor saves, and validates with no problems', async () => {
    const files = readGame();
    const opened = openProject(files);
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.issues).toEqual([]);
    expect(projectFiles(opened.project)).toEqual(files);
    expect(await validateProject(opened.project)).toEqual([]);
  });

  it('passes its scenario tests', () => {
    const results = runScenarios(game);
    expect(results.length).toBeGreaterThanOrEqual(4);
    for (const r of results) expect(r.failures, r.name).toEqual([]);
  });

  it('meets the reference game requirements (#7)', () => {
    const cards = items.filter((i) => i.kind === 'card');
    const ops = (c: ContentItem) => JSON.stringify(c);
    const positional = cards.filter((c) => /"op":"(push|pull|step|swap|approach|teleport)"/.test(ops(c)) || (c.targeting as { kind: string }).kind === 'tile');
    expect(cards.length).toBeGreaterThanOrEqual(30);
    expect(positional.length * 3).toBeGreaterThanOrEqual(cards.length);
    expect(cards.filter((c) => c.timing === 'reaction').length).toBeGreaterThanOrEqual(2);
    const permanent = (kind: string) => cards.filter((c) => (c.permanent as { kind?: string } | undefined)?.kind === kind).length;
    expect(permanent('trap')).toBeGreaterThanOrEqual(1);
    expect(permanent('structure')).toBeGreaterThanOrEqual(1);
    // Hidden information: partial or hidden intents, face-down traps, and fog.
    expect(JSON.stringify(items)).toMatch(/"visibility":"(partial|hidden)"/);
    const ruleset = game.definitions.rulesets['sporeline:main'] as RulesetDef;
    expect(ruleset.fog).toBeDefined();
    // 6 to 8 bugs and a boss.
    const bugs = items.filter((i) => i.kind === 'unit' && i.behavior && i.id !== 'sporeline:weevil-matriarch');
    expect(bugs.length).toBeGreaterThanOrEqual(6);
    expect(bugs.length).toBeLessThanOrEqual(8);
    // A run of 5 to 8 fights along any path.
    const map = runMapOf(ruleset);
    if (!map) throw new Error('no run');
    expect(Math.max(...runMapDepths(map).values()) + 1).toBeGreaterThanOrEqual(5);
  });
});

describe('Sporeline balance guards', () => {
  it('a careful (greedy) player clears an opening fight', () => {
    const s = summarize(simulate(game, { encounter: 'sporeline:leaf-trail', seeds: Array.from({ length: 20 }, (_, i) => i + 1), bot: 'greedy' }));
    expect(s.winRate).toBeGreaterThanOrEqual(0.9);
  });

  it('a full run is completable, and not every run is', () => {
    const runs = Array.from({ length: 12 }, (_, i) => simulateRun(game, i + 1));
    expect(runs.some((r) => r.won)).toBe(true);
    expect(runs.some((r) => !r.won)).toBe(true);
    expect(runs.filter((r) => r.won).every((r) => r.path.at(-1) === 'chamber')).toBe(true);
  }, 60_000);
});
