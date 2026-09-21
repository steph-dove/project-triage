import { expect, gotoHydrated, INTAKE, test } from './fixtures';

test('an intake goes from the form to a finished analysis', async ({ page, worker }) => {
  await worker.start();

  await gotoHydrated(page, '/intakes/new');
  await page.getByLabel('Title').fill(INTAKE.title);
  await page.getByLabel('Description').fill(INTAKE.description);
  await page.getByLabel('Budget range').fill(INTAKE.budgetRange);
  await page.getByLabel('Timeline').fill(INTAKE.timeline);
  await page.getByLabel('Industry').fill(INTAKE.industry);
  await page.getByRole('button', { name: 'Create intake' }).click();

  await expect(page).toHaveURL(/\/intakes\/[a-z0-9]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(INTAKE.title);

  // Not "Ready" as the signal: the live stepper has a stage by that name.
  await expect(page.getByText(/^mock · prompt /)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await expect(page.getByText(`${INTAKE.title}. We want to forecast`)).toBeVisible();
  for (const tag of ['mock', 'logistics', 'needs-review']) {
    await expect(page.getByText(tag, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

  await page.getByRole('link', { name: 'Intake Triage' }).click();
  const card = page.getByRole('link', { name: new RegExp(INTAKE.title) });
  await expect(card).toBeVisible();
  await expect(card.getByText('mock', { exact: true })).toBeVisible();
  await expect(card.getByText('New', { exact: true })).toBeVisible();
});
