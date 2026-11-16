import { expect, test, type Page } from '@playwright/test';

/** Counts the sounds started, by wrapping the real AudioContext's sources. */
async function countSounds(page: Page) {
  await page.addInitScript(() => {
    const counts = { started: 0 };
    (window as unknown as { sounds: typeof counts }).sounds = counts;
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      counts.started++;
      start.apply(this, args);
    };
  });
}
const started = (page: Page) => page.evaluate(() => (window as unknown as { sounds: { started: number } }).sounds.started);

async function startDuel(page: Page) {
  await page.getByRole('button', { name: /^Duel/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
}

test('playing a card makes sound; turned off it makes none, and stays off', async ({ page }) => {
  await countSounds(page);
  await page.goto('/?seed=4&encounter=duel:close-quarters');
  await startDuel(page);
  const hand = page.getByRole('list', { name: 'Hand' });

  // The first gesture allows audio; give it a moment to start.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.waitForTimeout(150);
  await hand.getByRole('button', { name: /^Iron Skin/ }).click();
  await expect.poll(() => started(page)).toBeGreaterThan(0);

  await page.getByLabel('Sound').selectOption({ label: 'Off' });
  await page.waitForTimeout(100);
  const before = await started(page);
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.getByRole('status')).toHaveText('Your response');
  expect(await started(page)).toBe(before);

  await page.reload();
  await startDuel(page);
  await expect(page.getByLabel('Sound')).toHaveValue('0');
});

test('a step still sounds at Instant speed', async ({ page }) => {
  await countSounds(page);
  await page.goto('/?seed=4&encounter=duel:close-quarters');
  await startDuel(page);
  await page.getByLabel('Animation').selectOption({ label: 'Instant' });
  await page.waitForTimeout(150);
  await page.getByRole('list', { name: 'Hand' }).getByRole('button', { name: /^Iron Skin/ }).click();
  await expect.poll(() => started(page)).toBeGreaterThan(0);
});
