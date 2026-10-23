import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Guards the lint rules that keep the core deterministic (decision #11), so a
// config change can't silently drop them.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((m) => m.ruleId) ?? [];
}

const nonDeterministic = [
  'export const x = Math.random();',
  'export const x = Date.now();',
  'export const x = new Date();',
  'export const x = performance.now();',
  'export const x = crypto.randomUUID();',
];

describe('determinism lint rules', () => {
  it.each(nonDeterministic)('rejects `%s` in packages/core', async (code) => {
    const ids = await ruleIds(code, 'packages/core/src/fixture.ts');
    expect(ids.some((id) => id?.startsWith('no-restricted-'))).toBe(true);
  });

  it('allows the same code outside packages/core', async () => {
    const ids = await ruleIds('export const x = Math.random();', 'packages/sdk/src/fixture.ts');
    expect(ids).not.toContain('no-restricted-properties');
  });
}, 30_000);
