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
  test.use({ viewport: { width: 960, height: 432 } });

  const drawerRaised = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Hand/ }).getAttribute('aria-expanded');

  test('the board takes the screen, and only the bar and card tops of the drawer show (#172)', async ({ page }) => {
    await start(page);
    const stage = await page.locator('.ccg-stage').boundingBox();
    expect(stage?.height).toBeGreaterThan(432 * 0.6);
    expect(stage?.width).toBeGreaterThan(960 * 0.9);
    await expect(page.getByRole('button', { name: 'End turn' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel('Unit details')).toBeHidden();
    await expect(page.getByLabel('Log')).toBeHidden();
    const card = await page.getByRole('list', { name: 'Hand' }).getByRole('button').first().boundingBox();
    expect(card?.y).toBeGreaterThan(432 - 60);
    await page.screenshot({ path: process.env.PHONE_SHOT ?? 'test-results/landscape.png' });
  });

  test('controls keep clear of a camera cutout the shell reports, while the theme runs to the edge', async ({ page }) => {
    await start(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--ccg-safe-left', '50px'));
    expect((await page.locator('.ccg-encounter').boundingBox())?.x).toBe(0);
    expect((await page.locator('.ccg-topbar h1').boundingBox())?.x).toBeGreaterThanOrEqual(50);
    expect((await page.locator('.ccg-tray').boundingBox())?.x).toBeGreaterThanOrEqual(50);
  });

  test('the drawer rises and falls by tap, and by swipe', async ({ page }) => {
    await start(page);
    const toggle = page.getByRole('button', { name: /^Hand/ });
    await toggle.tap();
    expect(await drawerRaised(page)).toBe('true');
    await page.waitForTimeout(250);
    await expect(page.getByRole('list', { name: 'Hand' }).getByRole('button').first()).toBeInViewport({ ratio: 0.9 });
    if (process.env.PHONE_SHOT) await page.screenshot({ path: process.env.PHONE_SHOT.replace('.png', '-open.png') });
    await toggle.tap();
    expect(await drawerRaised(page)).toBe('false');

    const swipe = async (from: number, to: number) => {
      const tray = page.locator('.ccg-tray');
      for (const [type, y] of [['pointerdown', from], ['pointerup', to]] as const) await tray.dispatchEvent(type, { clientY: y, bubbles: true });
    };
    await swipe(400, 300);
    expect(await drawerRaised(page)).toBe('true');
    await swipe(200, 320);
    expect(await drawerRaised(page)).toBe('false');
  });

  test('tapping a peeking card raises the drawer rather than playing it', async ({ page }) => {
    await start(page);
    const before = await page.getByRole('list', { name: 'Hand' }).getByRole('button').count();
    await page.touchscreen.tap(300, 425);
    expect(await drawerRaised(page)).toBe('true');
    expect(await page.getByRole('list', { name: 'Hand' }).getByRole('button').count()).toBe(before);
  });

  test('an encounter can be finished by touch: the drawer falls for targets and after each card', async ({ page }) => {
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
          if ((await drawerRaised(page)) !== 'true') await page.getByRole('button', { name: /^Hand/ }).tap();
          await page.waitForTimeout(220);
          await card.tap();
          const target = page.locator('.ccg-board').getByRole('button', { name: /^Play / }).first();
          if (await target.count()) {
            expect(await drawerRaised(page)).toBe('false');
            await target.tap();
          }
        } else {
          await page.getByRole('button', { name: 'End turn' }).tap();
        }
      }
      await page.waitForTimeout(50);
    }
    await expect(outcome).toBeVisible();
  });

  test('details float over the board when a unit is tapped, and the log when asked for', async ({ page }) => {
    await start(page);
    await page.locator('[data-unit]').first().tap();
    await expect(page.getByLabel('Unit details')).toContainText('HP');
    await page.getByRole('button', { name: 'Log' }).tap();
    await expect(page.getByLabel('Log', { exact: true })).toBeVisible();
  });
});
