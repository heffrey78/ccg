import { expect, test, type Page } from '@playwright/test';

async function newProject(page: Page) {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Cards');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();
}

const preview = (page: Page) => page.getByRole('complementary', { name: 'Preview' });

test('creates a card from scratch; the preview matches the card in play, and updates within 100 ms', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'New card' }).click();
  await page.getByRole('form', { name: 'New card' }).getByLabel('Name').fill('Fireball');
  await page.getByRole('button', { name: 'Add' }).click();

  // Play: cost and targeting.
  await page.getByRole('button', { name: '+ Cost' }).first().click();
  await page.getByLabel('Cost: resource').fill('energy');
  await page.getByRole('button', { name: '+ Cost' }).last().click();
  await page.getByLabel('Targeting kind').selectOption({ label: 'unit' });
  await page.getByRole('button', { name: '+ Range' }).click();
  await page.getByLabel('Range', { exact: true }).fill('3');
  await page.getByLabel('Range', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '+ Filter' }).click();
  await page.getByLabel('Filter', { exact: true }).selectOption('enemy');

  // Effects: damage, then a status from the project's keyword list.
  await page.getByRole('button', { name: '+ Add effect' }).click();
  await page.getByRole('dialog', { name: 'Add effect' }).getByRole('button', { name: 'Damage', exact: true }).click();
  const amount = page.locator('.ccg-effect[aria-label="Damage"]').getByLabel('Amount', { exact: true });
  await amount.fill('8');
  await amount.press('Enter');
  await expect(preview(page).getByLabel('Card text')).toHaveText('Deal 8 damage.');
  await expect(preview(page).getByRole('img', { name: /Card preview: Fireball\. Target an enemy within 3\. Deal 8 damage\./ })).toBeVisible();
  await expect(page.getByText('No problems found.')).toBeVisible();

  // The preview updates within 100 ms of committing an edit (measured in the page). The best of
  // three edits counts, so one scheduling hiccup on a busy machine doesn't fail the test.
  const timeEdit = (amount: number) =>
    page.evaluate(
      (amount) =>
        new Promise<number>((resolve) => {
          const input = document.querySelector('.ccg-effect[aria-label="Damage"] input[aria-label="Amount"]') as HTMLInputElement;
          const text = document.querySelector('[aria-label="Card text"]') as HTMLElement;
          const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (v: string) => void;
          const t0 = performance.now();
          const observer = new MutationObserver(() => {
            if (text.textContent === `Deal ${amount} damage.`) {
              observer.disconnect();
              resolve(performance.now() - t0);
            }
          });
          observer.observe(text, { childList: true, subtree: true, characterData: true });
          setValue.call(input, String(amount));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }),
      amount,
    );
  const times = [await timeEdit(10), await timeEdit(11), await timeEdit(12)];
  expect(Math.min(...times)).toBeLessThan(100);

  // Try it: the card in the playtest hand reads exactly like the preview.
  await page.getByRole('button', { name: 'Try it' }).click();
  const hand = page.getByRole('region', { name: 'Playtest' }).getByRole('list', { name: 'Hand' });
  const fireball = hand.getByRole('button', { name: /^Fireball/ });
  await expect(fireball).toHaveCount(1);
  await expect(fireball.locator('.ccg-card-text')).toHaveText('Deal 12 damage.');
  await expect(fireball).toHaveAccessibleName(/^Fireball, costs 1 energy\. Target an enemy within 3\. Deal 12 damage\./);
});

test('edits a status with hooks and a preview', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'New status' }).click();
  await page.getByRole('form', { name: 'New status' }).getByLabel('Name').fill('Burn');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: '+ Description' }).click();
  await page.getByLabel('Description', { exact: true }).fill('Takes damage each turn.');
  await page.getByLabel('Description', { exact: true }).press('Enter');
  await expect(preview(page)).toContainText('Burn');
  await expect(preview(page)).toContainText('Takes damage each turn.');

  await page.getByRole('button', { name: '+ Hooks' }).click();
  await page.getByRole('button', { name: '+ Add hooks' }).click();
  await page.getByLabel('On', { exact: true }).fill('PhaseStarted');
  await page.getByLabel('On', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '+ Add effect' }).click();
  await page.getByRole('dialog', { name: 'Add effect' }).getByRole('button', { name: 'Damage', exact: true }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();
  await expect(page.getByLabel('Item data')).toContainText('"on": "PhaseStarted"');
});
