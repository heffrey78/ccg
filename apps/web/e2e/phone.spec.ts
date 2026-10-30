import { devices, expect, test } from '@playwright/test';

const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7'];
test.use(pixel);

const start = async (page: import('@playwright/test').Page) => {
  await page.goto('/?seed=4&encounter=duel:close-quarters');
  await page.getByRole('button', { name: /^Duel/ }).tap();
  await expect(page.getByRole('status')).toHaveText('Your decision');
};

test('an encounter can be finished by touch alone at phone size (#162)', async ({ page }) => {
  await start(page);
  const hand = page.getByRole('list', { name: 'Hand' });
  const outcome = page.getByRole('heading', { name: /Victory|Defeat|Run complete|Run over/ });
  for (let step = 0; step < 200 && !(await outcome.isVisible()); step++) {
    const status = await page.getByRole('status').textContent();
    if (status === 'Your response') {
      await page.getByRole('button', { name: /^Pass/ }).tap();
    } else if (status === 'Your decision') {
      const card = hand.getByRole('button', { disabled: false }).first();
      if (await card.count()) {
        await card.tap();
        const target = page.locator('.ccg-board').getByRole('button', { name: /^Play / }).first();
        if (await target.count()) await target.tap();
      } else {
        await page.getByRole('button', { name: 'End turn' }).tap();
      }
    }
    await page.waitForTimeout(50);
  }
  await expect(outcome).toBeVisible();
});

test('the settings fold away, and nothing is wider than the phone', async ({ page }) => {
  await start(page);
  await expect(page.getByLabel('Sound')).toBeHidden();
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByLabel('Sound').selectOption({ label: 'Off' });
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByLabel('Sound')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('tapping a unit shows its details', async ({ page }) => {
  await start(page);
  const details = page.getByLabel('Unit details');
  await expect(details).toContainText('tap');
  await page.locator('[data-unit]').first().tap();
  await expect(details).toContainText('HP');
});

test.describe('on its side', () => {
  test.use({ viewport: { width: 867, height: 412 } });

  test('the board, the hand and End turn all fit on the screen without scrolling', async ({ page }) => {
    await start(page);
    const onScreen = async (name: string, locator: import('@playwright/test').Locator) => {
      const box = await locator.boundingBox();
      expect(box, name).not.toBeNull();
      expect((box as { y: number; height: number }).y + (box as { height: number }).height, name).toBeLessThanOrEqual(412);
    };
    await onScreen('board', page.locator('.ccg-board'));
    await onScreen('card', page.getByRole('list', { name: 'Hand' }).getByRole('button').first());
    await onScreen('end turn', page.getByRole('button', { name: 'End turn' }));
    await page.screenshot({ path: process.env.PHONE_SHOT ?? 'test-results/landscape.png' });
  });
});
