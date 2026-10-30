/**
 * The Android app end to end (#156): the APK on a device or the emulator, its webview driven by
 * Playwright's Android support, with the network off. It finds a game with no editor on offer,
 * plays by tapping, is killed mid-encounter and continues where it was.
 *
 *   pnpm --filter @ccg/desktop build:android:emulator
 *   pnpm --filter @ccg/web e2e:android [APK]
 *
 * ADB names adb if it isn't on PATH. SCREENSHOTS names a folder to keep what the device showed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { _android, expect, type AndroidDevice, type Locator, type Page } from '@playwright/test';

const PACKAGE = 'dev.ccg.engine';
const APK = process.argv[2] ?? new URL('../../desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk', import.meta.url).pathname;
const ADB = process.env.ADB ?? 'adb';
const SCREENSHOTS = process.env.SCREENSHOTS;

const adb = (...args: string[]) => execFileSync(ADB, args, { encoding: 'utf8' });
const launch = () => adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
const step = (text: string) => console.log(`• ${text}`);
const network = (on: boolean) => {
  for (const radio of ['wifi', 'data']) adb('shell', 'svc', radio, on ? 'enable' : 'disable');
};

function screenshot(name: string) {
  if (!SCREENSHOTS) return;
  mkdirSync(SCREENSHOTS, { recursive: true });
  writeFileSync(join(SCREENSHOTS, `${name}.png`), execFileSync(ADB, ['exec-out', 'screencap', '-p']));
}

/** The app's page, once its webview is up. */
async function appPage(device: AndroidDevice): Promise<Page> {
  const webview = await device.webView({ pkg: PACKAGE }, { timeout: 60_000 });
  return webview.page();
}

/** Where the webview sits on the screen, in device pixels. */
function webviewOrigin(): { x: number; y: number } {
  const ui = execFileSync(ADB, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { encoding: 'utf8' });
  const node = /class="android\.webkit\.WebView"[^>]*?bounds="\[(\d+),(\d+)\]/.exec(ui);
  if (!node) throw new Error('No webview on the screen.');
  return { x: Number(node[1]), y: Number(node[2]) };
}

/** Touches an element with a real tap on the screen, as a finger would. */
async function tap(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded({ timeout: 30_000 });
  const box = await target.boundingBox();
  if (!box) throw new Error('Nothing to tap.');
  const scale = await page.evaluate(() => devicePixelRatio);
  const origin = webviewOrigin();
  adb('shell', 'input', 'tap', String(Math.round(origin.x + (box.x + box.width / 2) * scale)), String(Math.round(origin.y + (box.y + box.height / 2) * scale)));
}

step(`Installing ${APK}, with the app's data cleared and the network off`);
adb('install', '-r', APK);
adb('shell', 'pm', 'clear', PACKAGE);
network(false);
// However this ends, the device gets its network back.
process.on('exit', () => network(true));

launch();
// After launching: Playwright's driver looks for the webview from when it attaches.
const [device] = await _android.devices();
if (!device) throw new Error('No device: start the emulator or plug in a phone.');
try {
  let page = await appPage(device);

  step('Play is offered without the editor');
  await expect(page.getByRole('button', { name: /^Duel/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'Mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  screenshot('1-games');

  step('A game starts and plays by tapping');
  await tap(page, page.getByRole('button', { name: /^Duel/ }));
  await expect(page.getByRole('status')).toHaveText('Your decision', { timeout: 30_000 });
  screenshot('2-encounter');
  await tap(page, page.getByRole('button', { name: 'End turn' }));
  await expect(page.locator('header').getByText('Round 2')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveText('Your decision', { timeout: 30_000 });
  const hand = await page.getByRole('list', { name: 'Hand' }).getByRole('button').allTextContents();
  screenshot('3-round-2');

  step('Killed mid-encounter, it offers Continue, and the game is as it was');
  adb('shell', 'am', 'force-stop', PACKAGE);
  await expect.poll(() => device.webViews().filter((w) => w.pkg() === PACKAGE).length).toBe(0);
  launch();
  page = await appPage(device);
  await tap(page, page.getByRole('button', { name: /^Continue/ }));
  await expect(page.locator('header').getByText('Round 2')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('list', { name: 'Hand' }).getByRole('button').allTextContents()).toEqual(hand);
  screenshot('4-continued');

  step('Passed');
} finally {
  await device.close();
}
// Playwright's driver would hold the process open.
process.exit(0);
