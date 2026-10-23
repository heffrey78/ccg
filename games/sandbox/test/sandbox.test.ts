import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { PackageRegistry, createGame, greedyPolicy, playTurn, type GameState } from '@ccg/core';
import { describe, expect, it } from 'vitest';
import sandbox, { ENEMY, PLAYER, type SandboxWorld } from '../src/index.js';

function resolve() {
  const registry = new PackageRegistry<SandboxWorld>();
  registry.register(sandbox);
  const result = registry.resolve('sandbox');
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.game;
}

/** Prefer leaving the brute weak, the duelist healthy, and blocks up. */
const score = (state: GameState<SandboxWorld>) => {
  const units = Object.values(state.world.board.units);
  const hp = (side: string) => units.filter((u) => u.side === side).reduce((n, u) => n + u.hp + u.block * 0.5, 0);
  return (state.outcome?.winners.includes(PLAYER) ? 1000 : 0) - 2 * hp(ENEMY) + hp(PLAYER);
};

describe('sandbox game package', () => {
  it('resolves through the registry with its custom op and namespaced content', () => {
    const game = resolve();
    expect(Object.keys(game.definitions.cards)).toEqual(['sandbox:jab', 'sandbox:shove', 'sandbox:brace', 'sandbox:lunge', 'sandbox:ember']);
    expect(game.ops.get('sandbox:refillEnergy')?.displayName).toBe('Refill energy');
  });

  it('plays the duel to a win with a scripted greedy player', () => {
    const game = resolve();
    const rules = game.createRules();
    const created = createGame(rules, game.createSetup({ seed: 7 }));
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state;
    expect(state.world.intents.declared[0]?.name).toBe('Stalk');
    expect(state.world.cards.zones[PLAYER]?.hand).toHaveLength(4);

    const policy = greedyPolicy<SandboxWorld>(score);
    for (let turn = 0; turn < 30 && !state.outcome; turn++) {
      const result = playTurn(rules, state, PLAYER, policy);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    expect(state.outcome).toEqual({ winners: [PLAYER], reason: 'the brute is down' });
  });
});

describe('package boundaries', () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../..', import.meta.url)) });
  const lint = async (code: string) => (await eslint.lintText(code, { filePath: 'games/sandbox/src/fixture.ts' }))[0]?.messages ?? [];

  it('allows the public entry points', async () => {
    expect(await lint("export { defineGame } from '@ccg/sdk';\nexport { apply } from '@ccg/core';\n")).toEqual([]);
  });

  it.each(["import { apply } from '@ccg/core/src/kernel/engine.js';", "import { apply } from '../../../packages/core/src/index.js';"])(
    'rejects `%s`',
    async (code) => {
      expect((await lint(`${code}\nexport { apply };\n`)).map((m) => m.ruleId)).toContain('no-restricted-imports');
    },
  );
}, 30_000);
