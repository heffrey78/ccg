import { expect, test, type Page } from '@playwright/test';

async function play(page: Page, query: string) {
  await page.goto(`/?${query}`);
  await page.getByRole('button', { name: /^Duel/ }).click();
  await expect(page.getByRole('status')).toHaveText(/Your (decision|response)/);
}

const hand = (page: Page) => page.getByRole('list', { name: 'Hand' });
const log = (page: Page) => page.getByRole('region', { name: 'Log' });

test('an enemy attack opens a reaction prompt, and the reaction resolves before the attack', async ({ page }) => {
  await play(page, 'seed=4&encounter=duel:close-quarters');
  await expect(page.locator('[data-unit][aria-label^="Foe, enemy, 20 of 20 HP, intends Hit"]')).toBeVisible();
  await page.getByRole('button', { name: 'End turn' }).click();

  const prompt = page.getByRole('alert').filter({ hasText: 'Respond with a reaction, or pass.' }).first();
  await expect(prompt).toContainText('Foe: Hit');
  await expect(page.getByRole('status')).toHaveText('Your response');
  // Only the reactions are playable, and they are highlighted.
  await expect(hand(page).locator('.ccg-card.is-eligible')).toHaveCount(2);
  await expect(hand(page).locator('.ccg-card.is-eligible .ccg-card-name')).toHaveText(['Brace', 'Brace']);

  await hand(page).getByRole('button', { name: /^Brace/ }).first().click();
  await expect(log(page)).toContainText('Hero takes 1 damage');
  const lines = await log(page).getByRole('listitem').allTextContents();
  expect(lines.indexOf('You played Brace')).toBeGreaterThanOrEqual(0);
  expect(lines.indexOf('You played Brace')).toBeLessThan(lines.indexOf('Hero takes 1 damage'));
  await expect(page.locator('[data-unit][aria-label^="Hero, yours, 29 of 30 HP"]')).toBeVisible();
});

test('fog hides units from the client, and a face-down trap shows only to its owner', async ({ page }) => {
  // Record everything the engine worker sends the page.
  await page.addInitScript(() => {
    const messages: unknown[] = [];
    (window as unknown as { engineMessages: unknown[] }).engineMessages = messages;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => messages.push(event.data));
      }
    };
  });
  await play(page, 'seed=3&encounter=duel:first-fight');

  // The foe is 6 tiles away, beyond sight (4): the board shows fog, and the client was never told about it.
  await expect(page.locator('[data-unit]')).toHaveCount(1);
  await expect(page.locator('.ccg-cell.is-fogged')).toHaveCount(2);
  const received = JSON.stringify(await page.evaluate(() => (window as unknown as { engineMessages: unknown[] }).engineMessages));
  expect(received).toContain('"vision"');
  expect(received).not.toContain('enemy1');
  expect(received).not.toContain('"secret"');

  // Place a Snare: the owner sees the trap on the board.
  await hand(page).getByRole('button', { name: /^Snare/ }).click();
  await page.locator('.ccg-board').getByRole('button', { name: 'Play Snare → 3' }).click();
  await expect(page.locator('[data-unit][data-pos="3"]')).toHaveAttribute('aria-label', /^Snare, yours/);
  await expect(page.locator('[data-unit][data-pos="3"]')).toHaveClass(/is-passable/);
  await expect(page.getByRole('region', { name: 'Permanents' })).toContainText('Snare');
});

test('auras and attachments show on the board and in the permanents list', async ({ page }) => {
  await play(page, 'seed=4&encounter=duel:close-quarters');
  await hand(page).getByRole('button', { name: /^Iron Skin/ }).click();
  await expect(page.locator('.ccg-attachment')).toHaveAttribute('aria-label', 'Iron Skin attached');
  await expect(page.locator('[data-unit][aria-label^="Hero, yours, 30 of 35 HP"]')).toBeVisible();
  await hand(page).getByRole('button', { name: /^War Banner/ }).click();
  await page.locator('.ccg-board').getByRole('button', { name: 'Play War Banner → 2' }).click();
  await expect(page.locator('.ccg-aura')).toHaveAttribute('aria-label', 'War Banner (aura) on 2');
  await expect(page.getByRole('region', { name: 'Permanents' }).getByRole('listitem')).toHaveCount(2);
  await expect(log(page)).toContainText('War Banner enters play');
});
