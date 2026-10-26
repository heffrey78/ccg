import { expect, test } from '@playwright/test';

test('Sporeline starts a run on its fungal network: a lane of 9 in the dark, bugs on the way', async ({ page }) => {
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  await expect(page.getByText('Encounter 1 of 7')).toBeVisible();
  await expect(page.locator('.ccg-board .ccg-cell')).toHaveCount(9);
  await expect(page.locator('[data-unit][aria-label^="The Knot, yours, 40 of 40 HP"]')).toBeVisible();
  // Sight 3: the far end of the lane is dark, and the leafcutters there are unseen.
  await expect(page.locator('.ccg-cell.is-fogged')).toHaveCount(5);
  await expect(page.locator('[data-unit][aria-label^="Leafcutter"]')).toHaveCount(0);
  await expect(page.getByLabel('Resources')).toContainText('3 sap');
  // The art: the encounter's scene, the Knot's sprite, and every card in hand has art.
  await expect(page.locator('.ccg-board image.ccg-scene')).toHaveAttribute('href', /^blob:/);
  await expect(page.locator('[data-unit][aria-label^="The Knot"] image.ccg-unit-sprite')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Hand' }).locator('img.ccg-card-art')).toHaveCount(5);
  await expect(page.getByRole('list', { name: 'Hand' }).getByRole('button')).toHaveCount(5);
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('header').getByText('Round 2')).toBeVisible();
  // The leafcutters march out of the dark.
  await expect(page.locator('[data-unit][aria-label^="Leafcutter"]').first()).toBeVisible();
});

test('hovering a unit shows its details without moving the log or the hand', async ({ page }) => {
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  const log = page.getByRole('region', { name: 'Log' });
  const hand = page.getByRole('list', { name: 'Hand' });
  const before = [(await log.boundingBox())?.y, (await hand.boundingBox())?.y];
  await page.locator('[data-unit][aria-label^="The Knot"]').hover();
  await expect(page.getByRole('region', { name: 'Unit details' }).getByRole('heading', { name: 'The Knot' })).toBeVisible();
  expect([(await log.boundingBox())?.y, (await hand.boundingBox())?.y]).toEqual(before);
});

test('the log scrolls in its box as it fills, so the hand stays put', async ({ page }) => {
  // Tall enough that clicking End turn doesn't scroll the page.
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  const hand = page.getByRole('list', { name: 'Hand' });
  const log = page.getByRole('region', { name: 'Log' }).getByRole('list');
  const before = (await hand.boundingBox())?.y;
  for (let round = 2; round <= 4; round++) {
    await page.getByRole('button', { name: 'End turn' }).click();
    await expect(page.locator('header').getByText(`Round ${round}`)).toBeVisible();
  }
  await expect(log.getByRole('listitem')).not.toHaveCount(0);
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect((await hand.boundingBox())?.y).toBe(before);
});

test('a hit plays out on the board: the shot flies, the target flashes, the attacker recoils', async ({ page }) => {
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  // Beats are brief, so record every motion class the board shows while the rounds play.
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { seen: Set<string> }).seen = seen;
    const note = (el: Element) => {
      const unit = el.closest('[data-unit]')?.getAttribute('aria-label')?.split(',')[0] ?? '';
      for (const c of el.classList) if (c.startsWith('is-') || c === 'ccg-projectile') seen.add(`${unit}:${c}`);
    };
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.target instanceof Element && r.type === 'attributes') note(r.target);
        for (const n of r.addedNodes) if (n instanceof Element) [n, ...n.querySelectorAll('*')].forEach(note);
      }
    }).observe(document.querySelector('.ccg-board') as Element, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  // The leafcutter closes in, then spits at the Knot from two tiles away.
  for (let round = 2; round <= 3; round++) {
    await page.getByRole('button', { name: 'End turn' }).click();
    await expect(page.locator('header').getByText(`Round ${round}`)).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Your decision');
  }
  // Normal, the default level, scales the spit's 4 damage to 6.
  await expect(page.getByRole('region', { name: 'Log' })).toContainText('The Knot takes 6 damage');
  // The log updates at once; the board plays the hit out after it.
  await expect.poll(() => page.evaluate(() => [...(window as unknown as { seen: Set<string> }).seen])).toEqual(expect.arrayContaining([':ccg-projectile', 'The Knot:is-hit', 'The Knot:is-ranged', 'Leafcutter:is-lunging']));
});

test('the board can be drawn wide or full screen, and the choice of windowed view is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  const board = page.locator('.ccg-board');
  const size = async () => (await board.boundingBox()) ?? { width: 0, height: 0 };
  const standard = await size();
  await page.getByLabel('View').selectOption('wide');
  await expect.poll(async () => (await size()).width).toBeGreaterThan(standard.width + 200);
  const wide = await size();
  await page.keyboard.press('f');
  await expect(page.locator('.ccg-encounter.is-view-full')).toBeVisible();
  await expect.poll(async () => (await size()).height).toBeGreaterThan(wide.height);
  // The hand and End turn stay on screen.
  await expect(page.getByRole('button', { name: 'End turn' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ccg-encounter.is-view-wide')).toBeVisible();
  // Wide is remembered; full screen is not.
  await page.reload();
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.locator('.ccg-encounter.is-view-wide')).toBeVisible();
});

test('a difficulty picked on the game list scales the fights and is remembered (#125)', async ({ page }) => {
  await page.goto('/?seed=3');
  const level = page.getByLabel('Sporeline difficulty');
  await expect(level).toHaveValue('normal');
  await expect(page.getByText('Tougher bugs that hit harder.')).toBeVisible();
  await level.selectOption('story');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.locator('header').getByText('Story')).toBeVisible();
  // The leafcutter's 4-damage spit is telegraphed at Story's 75%.
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('[data-unit][aria-label^="Leafcutter"] .ccg-intent').first()).toHaveText('⚔ 3');
  await page.reload();
  await expect(page.getByLabel('Sporeline difficulty')).toHaveValue('story');
});

test('Sporeline plays in its own theme: loam colours, Fraunces headings, strain card frames; Duel keeps the plain look (#137)', async ({ page }) => {
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  const encounter = page.locator('.ccg-encounter');
  await expect(encounter).toHaveClass(/ccg-themed/);
  await expect(page.locator('.ccg-tray')).toHaveCSS('background-color', 'rgb(34, 26, 20)');
  // The starting deck is the Knot's own cards, in the Knot's frame.
  const hand = page.getByRole('list', { name: 'Hand' }).getByRole('button');
  await expect(hand.first()).toHaveAttribute('data-frame', 'knot');
  await expect(page.locator('#encounter-heading')).toHaveCSS('font-family', /Fraunces/);
  await expect.poll(() => page.evaluate(() => document.fonts.check('600 16px "ccg-display"'))).toBe(true);

  await page.getByRole('button', { name: 'Quit' }).click();
  await page.getByRole('button', { name: /^Duel/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  await expect(page.locator('.ccg-encounter')).not.toHaveClass(/ccg-themed/);
  await expect(page.getByRole('list', { name: 'Hand' }).getByRole('button').first()).not.toHaveAttribute('data-frame');
});
