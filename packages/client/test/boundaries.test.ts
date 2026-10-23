import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Requirement #6: the client plays any game package and never depends on a specific one.
describe('client package boundaries', () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../..', import.meta.url)) });
  const ruleIds = async (code: string) =>
    ((await eslint.lintText(code, { filePath: 'packages/client/src/ui/fixture.tsx' }))[0]?.messages ?? []).map((m) => m.ruleId);

  it.each(["import sandbox from '@ccg/game-sandbox';", "import sandbox from '../../../games/sandbox/src/index.js';"])('rejects `%s`', async (code) => {
    expect(await ruleIds(`${code}\nexport { sandbox };\n`)).toContain('no-restricted-imports');
  });

  it('allows engine packages', async () => {
    expect(await ruleIds("export { apply } from '@ccg/core';\n")).toEqual([]);
  });
}, 30_000);
