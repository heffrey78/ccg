import { devices, expect, test, type Page } from '@playwright/test';

// Making and editing a game on a phone: the editor at phone size, by touch.
const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7'];
test.use(pixel);

const content = (page: Page) => page.getByRole('navigation', { name: 'Content' });
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function newGame(page: Page, name: string) {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).tap();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('the content list and the thing being edited take turns on the screen', async ({ page }) => {
  await newGame(page, 'Pocket Game');
  // A new game opens on its content, not on a form.
  await expect(content(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Game settings' })).toBeHidden();
  expect(await fits(page)).toBe(true);

  await content(page).getByRole('button', { name: /^Strike strike/ }).tap();
  await expect(page.getByRole('heading', { name: 'Strike', level: 2 })).toBeVisible();
  await expect(content(page)).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Preview' })).toBeVisible();
  expect(await fits(page)).toBe(true);

  await page.getByRole('button', { name: 'All content' }).tap();
  await expect(content(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Strike', level: 2 })).toBeHidden();
});

test('a card is made, edited and saved by touch, and a problem leads to its field', async ({ page }) => {
  await newGame(page, 'Touch Game');
  await page.getByRole('button', { name: 'New card' }).tap();
  await page.getByRole('form', { name: 'New card' }).getByLabel('Name').fill('Zap');
  await page.getByRole('button', { name: 'Add' }).tap();
  // The new card opens to be edited.
  await expect(page.getByRole('heading', { name: 'Zap', level: 2 })).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).tap();
  await expect(page.getByText('Saved in this browser')).toBeVisible();
  expect(await fits(page)).toBe(true);

  // Every editor screen keeps to the phone's width: an encounter, a unit with behaviour, the ruleset.
  for (const item of [/^First Fight/, /^Foe foe/]) {
    await page.getByRole('button', { name: 'All content' }).tap();
    await content(page).getByRole('button', { name: item }).tap();
    expect(await fits(page)).toBe(true);
  }
});

test('a game made on the phone installs into Play, plays, and can be removed', async ({ page }) => {
  await newGame(page, 'Carry Game');
  await page.getByText('Export', { exact: true }).tap();
  await page.getByRole('button', { name: 'Install in Play' }).tap();
  await expect(page.getByRole('status')).toContainText("Installed Carry Game. It's in Play now.");

  await page.getByRole('link', { name: 'Play' }).tap();
  const game = page.getByRole('button', { name: /^Carry Game/ });
  await expect(game).toBeVisible();
  // It's still there after the page is closed and opened again.
  await page.reload();
  await game.tap();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  await page.getByRole('button', { name: 'Quit' }).tap();

  await page.getByRole('button', { name: 'Remove Carry Game' }).tap();
  await page.getByRole('group', { name: 'Remove Carry Game?' }).getByRole('button', { name: 'Remove' }).tap();
  await expect(page.getByRole('button', { name: /^Duel/ })).toBeVisible();
  await expect(game).toHaveCount(0);
});

test('a playtest takes the screen, and Quit returns to the editor', async ({ page }) => {
  await newGame(page, 'Trial Game');
  await page.getByRole('button', { name: 'Playtest' }).tap();
  await page.getByRole('button', { name: 'Start', exact: true }).tap();
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Your decision' })).toBeVisible();
  const encounter = await page.locator('.ccg-encounter').boundingBox();
  const size = page.viewportSize();
  expect(encounter?.width).toBe(size?.width);
  expect(encounter?.height).toBe(size?.height);
  await page.getByRole('button', { name: 'Quit' }).tap();
  await expect(page.getByRole('heading', { name: 'Playtest' })).toBeVisible();
  await expect(page.locator('.ccg-encounter')).toHaveCount(0);
});

test("Sporeline's cards are printed: paper stock in the strain's ink, shown the same in the editor", async ({ page }) => {
  await page.goto('/#/create/edit/sporeline');
  await expect(page.getByRole('heading', { name: 'Sporeline', level: 1 })).toBeVisible();
  await content(page).getByRole('button', { name: /^Surge surge/ }).tap();
  const card = page.getByRole('img', { name: /^Card preview: Surge/ });
  await expect(card).toHaveAttribute('data-frame', 'rootdrinker');
  await expect(card).toHaveCSS('background-color', 'rgb(239, 227, 198)');
  await expect(card).toHaveCSS('border-top-color', 'rgb(35, 95, 148)');
  await expect(card).toHaveCSS('color', 'rgb(31, 24, 18)');
});
