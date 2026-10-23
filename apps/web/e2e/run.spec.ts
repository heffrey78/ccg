import { expect, test, type Page } from '@playwright/test';

const content = (page: Page) => page.getByRole('navigation', { name: 'Content' });

async function commit(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press('Enter');
}

test('a three-encounter run with rewards plays end to end from the editor', async ({ page }) => {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Gauntlet');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();

  // Quick fights: a 1 HP foe, and a Strike that reaches it from anywhere.
  await content(page).getByRole('button', { name: /^Foe foe/ }).click();
  await commit(page, 'Hp', '1');
  await content(page).getByRole('button', { name: /^Strike strike/ }).click();
  await commit(page, 'Range', '9');

  // Three encounters: First Fight and two copies.
  for (let i = 0; i < 2; i++) {
    await content(page).getByRole('button', { name: /^First Fight first-fight$/ }).click();
    await page.getByRole('button', { name: 'Duplicate' }).click();
  }

  // The run: those encounters in order, with Guard as a reward.
  await content(page).getByRole('button', { name: /^Rules main/ }).click();
  await page.getByRole('button', { name: '+ Run' }).click();
  await page.getByLabel('Encounters 1', { exact: true }).selectOption('first-fight');
  await page.getByRole('button', { name: '+ Add encounters' }).click();
  await page.getByLabel('Encounters 2', { exact: true }).selectOption('first-fight-2');
  await page.getByRole('button', { name: '+ Add encounters' }).click();
  await page.getByLabel('Encounters 3', { exact: true }).selectOption('first-fight-3');
  await page.getByRole('button', { name: '+ Rewards' }).click();
  await page.getByRole('button', { name: '+ Add pool' }).click();
  await page.getByLabel('Pool 1', { exact: true }).selectOption('guard');
  await expect(page.getByText('No problems found.')).toBeVisible();

  await page.getByRole('button', { name: 'Playtest' }).click();
  const pane = page.getByRole('region', { name: 'Playtest' });
  await pane.getByLabel('Encounter or scenario').selectOption({ label: 'Run: every encounter in order' });
  await pane.getByRole('button', { name: 'Start' }).click();

  const strike = async () => {
    await pane.getByRole('list', { name: 'Hand' }).getByRole('button', { name: /^Strike/ }).first().click();
    await pane.getByRole('group', { name: 'Choose a target' }).getByRole('button', { name: 'Play Strike → Foe' }).click();
  };
  const outcome = pane.getByRole('dialog');

  await expect(pane.getByText('Encounter 1 of 3')).toBeVisible();
  await strike();
  await expect(outcome).toContainText('Choose a card to add to your deck.');
  await outcome.getByRole('button', { name: 'Take Guard' }).click();

  await expect(pane.getByText('Encounter 2 of 3')).toBeVisible();
  await strike();
  await outcome.getByRole('button', { name: 'Skip' }).click();

  await expect(pane.getByText('Encounter 3 of 3')).toBeVisible();
  await strike();
  await expect(outcome.getByRole('heading', { name: 'Run complete' })).toBeVisible();
});
