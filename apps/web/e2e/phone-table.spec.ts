import { devices, expect, test, type Page } from '@playwright/test';

// Sporeline's theme asks for the card table (board: "table"), which a phone draws for its lane.
const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7'];
test.use(pixel);

const start = async (page: Page) => {
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).tap();
  await expect(page.getByRole('status')).toHaveText('Your decision');
};
const endTurn = async (page: Page, round: number) => {
  await page.getByRole('button', { name: 'End turn' }).tap();
  await expect(page.locator('header').getByText(`Round ${round}`)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Your decision');
};
/** The smallest text on the table that a player has to read, in screen pixels. */
const smallestLabel = (page: Page) =>
  page.evaluate(() =>
    Math.min(
      ...[...document.querySelectorAll<HTMLElement>('.ccg-ucard-hp, .ccg-ucard-block, .ccg-ucard-intent, .ccg-away, .ccg-token b, .ccg-ucard-name')].map(
        (el) => (parseFloat(getComputedStyle(el).fontSize) * el.getBoundingClientRect().height) / el.offsetHeight,
      ),
    ),
  );

test('a lane is a root winding up the table, with every unit a card on its stone', async ({ page }) => {
  await start(page);
  const table = page.getByRole('group', { name: 'lane board' });
  await expect(table).toHaveClass(/ccg-table/);
  await expect(table).toHaveClass(/is-upright/);
  await expect(table.locator('.ccg-cell')).toHaveCount(9);
  await expect(table.locator('.ccg-cell.is-fogged')).toHaveCount(5);
  const knot = page.locator('[data-unit][aria-label^="The Knot, yours, 40 of 40 HP"]');
  await expect(knot.locator('.ccg-ucard-hp')).toHaveText('40');
  await expect(knot.locator('img.ccg-unit-sprite')).toHaveCount(1);
  // The table is the screen: it runs behind the bar and the hand.
  const stage = await page.locator('.ccg-stage').boundingBox();
  expect(stage).toEqual({ x: 0, y: 0, width: 412, height: page.viewportSize()?.height });
  // The stones count steps from the Knot.
  await expect(table.locator('.ccg-step')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('nothing a player must read on the table is under 12 pixels, near or far', async ({ page }) => {
  await start(page);
  expect(await smallestLabel(page)).toBeGreaterThanOrEqual(12);
  // The leafcutters march out of the dark at the far end, where cards are smallest.
  await endTurn(page, 2);
  await expect(page.locator('[data-unit][aria-label^="Leafcutter"]').first()).toBeVisible();
  await expect(page.locator('.ccg-away').first()).toHaveText(/^\d away$/);
  expect(await smallestLabel(page)).toBeGreaterThanOrEqual(12);
});

test('the hand is a fan: a tap raises a card to be read, and a second tap plays one that needs no target', async ({ page }) => {
  await start(page);
  const cards = page.getByRole('list', { name: 'Hand' }).getByRole('button');
  await expect(cards).toHaveCount(5);
  const width = page.viewportSize()?.width ?? 0;
  // Every card shows its top corner, where its cost and name are.
  for (const card of await cards.all()) {
    const box = await card.boundingBox();
    expect(box?.x).toBeLessThan(width - 30);
    expect(box?.y).toBeLessThan((page.viewportSize()?.height ?? 0) - 60);
  }
  await expect(page.getByRole('button', { name: 'End turn' })).toBeInViewport({ ratio: 1 });

  // With no bug in reach, Hyphal Lash can't be played: a tap still raises it whole, so it can be read.
  const lash = cards.filter({ hasText: 'Hyphal Lash' }).first();
  await expect(lash).toHaveAttribute('aria-disabled', 'true');
  await lash.tap({ position: { x: 36, y: 36 }, force: true });
  await expect(lash).toHaveClass(/is-lifted/);
  await expect(lash).toBeInViewport({ ratio: 1 });

  const mat = cards.filter({ hasText: 'Mycelial Mat' }).first();
  await mat.tap({ position: { x: 36, y: 36 } });
  await expect(mat).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ccg-caption')).toContainText('Tap it again to play');
  await expect(cards).toHaveCount(5);
  await mat.tap({ position: { x: 36, y: 36 } });
  await expect(cards).toHaveCount(4);
  await expect(page.locator('[data-unit][aria-label^="The Knot"] .ccg-ucard-block')).toHaveText('5');
  // The log is one line under the table until it is asked for.
  await expect(page.locator('.ccg-caption')).toContainText('The Knot gains 5 block');
  await expect(page.getByLabel('Log')).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).tap();
  await expect(page.getByLabel('Log')).toContainText('The Knot gains 5 block');
});

test('a chosen card lights its reach along the root and prints what it would do on its target', async ({ page }) => {
  await start(page);
  await endTurn(page, 2);
  await endTurn(page, 3);
  const leafcutter = page.locator('[data-unit][aria-label^="Leafcutter"]').first();
  await expect(leafcutter.locator('.ccg-ucard-intent')).toContainText(/Spit 6/i);
  await expect(page.locator('[data-unit][aria-label^="The Knot"] .ccg-ucard-intent')).toHaveText('−6 next');
  await page.getByRole('list', { name: 'Hand' }).getByRole('button').filter({ hasText: 'Spore Puff' }).first().tap({ position: { x: 36, y: 36 } });
  await expect(page.locator('.ccg-reach')).toHaveCount(1);
  await expect(leafcutter.locator('.ccg-fore')).toHaveText('Rot +2');
  await page.locator('.ccg-table').getByRole('button', { name: /^Play Spore Puff/ }).tap();
  await expect(leafcutter.locator('.ccg-token')).toContainText('2');
  await expect(page.locator('.ccg-reach')).toHaveCount(0);
});

test('a card dragged from the hand aims at what it can reach, and letting go plays it', async ({ page }) => {
  await start(page);
  await endTurn(page, 2);
  await endTurn(page, 3);
  const cards = page.getByRole('list', { name: 'Hand' }).getByRole('button');
  const count = await cards.count();
  const from = await cards.filter({ hasText: 'Spore Puff' }).first().boundingBox();
  const to = await page.locator('[data-unit][aria-label^="Leafcutter"]').first().boundingBox();
  if (!from || !to) throw new Error('Nothing to drag.');
  await page.mouse.move(from.x + 16, from.y + 16);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y - 40, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator('.ccg-aim.is-locked')).toHaveCount(1);
  await expect(page.locator('[data-unit].is-aimed')).toHaveCount(1);
  await page.mouse.up();
  await expect(cards).toHaveCount(count - 1);
  await expect(page.locator('[data-unit][aria-label^="Leafcutter"]').first().locator('.ccg-token')).toContainText('2');
  await expect(page.locator('.ccg-aim')).toHaveCount(0);

  // Let go over nothing, and the card goes back to the hand.
  const mat = await cards.filter({ hasText: 'Mycelial Mat' }).first().boundingBox();
  if (!mat) throw new Error('No Mycelial Mat.');
  await page.mouse.move(mat.x + 16, mat.y + 16);
  await page.mouse.down();
  await page.mouse.move(mat.x + 40, mat.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect(cards).toHaveCount(count - 1);
});

test('tapping a unit brings it forward and shows its details', async ({ page }) => {
  await start(page);
  const knot = page.locator('[data-unit][aria-label^="The Knot"]');
  await expect(page.getByLabel('Unit details')).toBeHidden();
  await knot.tap();
  await expect(knot).toHaveClass(/is-peeked/);
  await expect(page.getByLabel('Unit details')).toContainText('HP');
  await knot.tap();
  await expect(page.getByLabel('Unit details')).toBeHidden();
});

test.describe('on its side', () => {
  test.use({ viewport: { width: 915, height: 412 } });

  test('the root runs across the table, and the hand peeks over the edge', async ({ page }) => {
    await start(page);
    const table = page.getByRole('group', { name: 'lane board' });
    await expect(table).toHaveClass(/is-wide/);
    await expect(table.locator('.ccg-cell')).toHaveCount(9);
    await expect(page.getByRole('button', { name: 'End turn' })).toBeInViewport({ ratio: 1 });
    const cards = page.getByRole('list', { name: 'Hand' }).getByRole('button');
    await expect(cards).toHaveCount(5);
    expect((await cards.first().boundingBox())?.y).toBeGreaterThan(412 - 70);
    expect(await smallestLabel(page)).toBeGreaterThanOrEqual(12);
    // A tapped card comes out whole, clear of the root.
    const mat = cards.filter({ hasText: 'Mycelial Mat' }).first();
    await mat.tap({ position: { x: 50, y: 24 } });
    await expect(mat).toBeInViewport({ ratio: 1 });
    await mat.tap({ position: { x: 50, y: 24 } });
    await expect(cards).toHaveCount(4);
  });
});

test('a wide screen keeps the tile board', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  await expect(page.locator('svg.ccg-board')).toBeVisible();
  await expect(page.locator('.ccg-table')).toHaveCount(0);
  await page.close();
});
