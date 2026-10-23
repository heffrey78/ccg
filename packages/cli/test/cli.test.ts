import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/duel', import.meta.url));

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

describe('ccg', () => {
  it('runs the example game’s scenarios, all passing', async () => {
    const { code, out } = await run('test', EXAMPLE);
    expect(out).toEqual([
      '✓ A strike fells the training dummy (duel:dummy-falls)',
      "✓ Guard absorbs the foe's hit (duel:guard-absorbs-a-hit)",
      '✓ Strike lands for 6 (duel:strike-lands)',
      '3 scenarios: 3 passed, 0 failed',
    ]);
    expect(code).toBe(0);
  });

  it('fails when a change breaks a scenario, saying why', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccg-cli-'));
    cpSync(EXAMPLE, dir, { recursive: true });
    const card = join(dir, 'content/cards/strike.json');
    writeFileSync(card, readFileSync(card, 'utf8').replace('"amount": 6', '"amount": 5'));
    const { code, out } = await run('test', dir);
    expect(code).toBe(1);
    expect(out).toContain("    expected Foe's HP to be 14, but it is 15");
    // The 6 HP dummy also survives a 5 damage strike now.
    expect(out.at(-1)).toBe('3 scenarios: 1 passed, 2 failed');
  });

  it('validates content and reports problems with their file', async () => {
    expect(await run('validate', EXAMPLE)).toMatchObject({ code: 0, out: ['Duel 0.1.0: no problems'] });
    const dir = mkdtempSync(join(tmpdir(), 'ccg-cli-'));
    cpSync(EXAMPLE, dir, { recursive: true });
    writeFileSync(join(dir, 'content/units/hero.json'), '{"formatVersion": 1, "kind": "unit", "id": "hero", "name": "Hero", "hp": 0}\n');
    const { code, err } = await run('validate', dir);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/content\/units\/hero\.json \/hp: /);
    expect((await run('nope', dir)).code).toBe(2);
  });
});
