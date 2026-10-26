import { expect, test } from '@playwright/test';

/**
 * The desktop adapters (#141–#143) against a stand-in for the Tauri shell:
 * `@tauri-apps/api` talks to `window.__TAURI_INTERNALS__`, so the page runs
 * exactly as on desktop, with the shell's commands answered here.
 */
test('on desktop, settings persist in the shell and installed packages appear in Play (#143)', async ({ page }) => {
  await page.addInitScript(() => {
    const enc = new TextEncoder();
    const json = (v: object) => enc.encode(JSON.stringify(v));
    const files: Record<string, Uint8Array> = {
      'game.json': json({ formatVersion: 1, id: 'disk-game', name: 'Disk Game', version: '1.0.0', engine: '^0.0.0', description: 'Installed from the packages folder.' }),
      'content/cards/zap.json': json({ formatVersion: 1, kind: 'card', id: 'zap', name: 'Zap', targeting: { kind: 'unit', filter: 'enemy' }, effects: [{ op: 'damage', amount: 5 }] }),
      'content/units/hero.json': json({ formatVersion: 1, kind: 'unit', id: 'hero', name: 'Hero', hp: 20 }),
      'content/units/dummy.json': json({ formatVersion: 1, kind: 'unit', id: 'dummy', name: 'Dummy', hp: 30 }),
      'content/encounters/one.json': json({ formatVersion: 1, kind: 'encounter', id: 'one', name: 'One', units: [{ unit: 'hero', side: 'player', pos: '0' }, { unit: 'dummy', side: 'enemy', pos: '3' }] }),
      'content/rulesets/main.json': json({ formatVersion: 1, kind: 'ruleset', id: 'main', name: 'Main', board: { topology: 'lane', length: 4 }, player: { resources: {}, handSize: 3, deck: ['zap', 'zap', 'zap'] } }),
    };
    const kv = JSON.parse(sessionStorage.getItem('shell-kv') ?? '{}') as Record<string, string>;
    const calls: string[] = [];
    (window as unknown as { shellCalls: string[] }).shellCalls = calls;
    (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => 0,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push(cmd);
        const save = () => sessionStorage.setItem('shell-kv', JSON.stringify(kv));
        switch (cmd) {
          case 'kv_get':
            return kv[args.key as string] ?? null;
          case 'kv_set':
            kv[args.key as string] = args.value as string;
            return save();
          case 'kv_delete':
            delete kv[args.key as string];
            return save();
          case 'kv_keys':
            return Object.keys(kv).filter((k) => k.startsWith(args.prefix as string)).sort();
          case 'packages_list':
            return [{ kind: 'folder', name: 'disk-game', files: Object.keys(files) }];
          case 'packages_read':
            return files[args.path as string]?.slice().buffer;
          case 'packages_reveal':
            return null;
          default:
            throw new Error(`unexpected command ${cmd}`);
        }
      },
    };
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Disk Game/ })).toBeVisible();
  await expect(page.getByText('Installed from the packages folder.')).toBeVisible();
  await page.getByRole('button', { name: 'Open packages folder' }).click();
  expect(await page.evaluate(() => (window as unknown as { shellCalls: string[] }).shellCalls)).toContain('packages_reveal');

  // Settings go to the shell's storage, and are there after a restart.
  await page.getByRole('button', { name: /^Disk Game/ }).click();
  await page.getByLabel('Animation').selectOption('4');
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('shell-kv') ?? '{}')['settings:animationSpeed'])).toBe('4');
  await page.reload();
  await page.getByRole('button', { name: /^Disk Game/ }).click();
  await expect(page.getByLabel('Animation')).toHaveValue('4');
});
