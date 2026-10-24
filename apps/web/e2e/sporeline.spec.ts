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
  await expect(page.getByRole('region', { name: 'Log' })).toContainText('The Knot takes 4 damage');
  // The log updates at once; the board plays the hit out after it.
  await expect.poll(() => page.evaluate(() => [...(window as unknown as { seen: Set<string> }).seen])).toEqual(expect.arrayContaining([':ccg-projectile', 'The Knot:is-hit', 'The Knot:is-ranged', 'Leafcutter:is-lunging']));
});
