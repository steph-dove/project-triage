import { db, expect, gotoHydrated, INTAKE, seedIntakes, test } from './fixtures';

test('an empty database says so and points at the form', async ({ page }) => {
  await gotoHydrated(page, '/');

  await expect(page.getByRole('heading', { name: 'No intakes yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Create your first intake' }).click();
  await expect(page).toHaveURL('/intakes/new');
});

test('a filter with no matches is told apart from an empty database', async ({ page }) => {
  await seedIntakes(2);

  await gotoHydrated(page, '/?status=ACCEPTED');

  await expect(page.getByRole('heading', { name: 'No intakes match this filter' })).toBeVisible();
  await expect(
    page.getByText('There are 2 intakes in total, but none with the status Accepted.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No intakes yet' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Clear filter' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: /Seeded intake/ })).toHaveCount(2);
});

test('the form refuses an incomplete intake field by field', async ({ page }) => {
  await gotoHydrated(page, '/intakes/new');

  await page.getByRole('button', { name: 'Create intake' }).click();

  for (const message of [
    'Give the request a title.',
    'Give at least 40 characters so the triage summary has something to work with.',
    'Give a budget range, or say it is not decided yet.',
    'Give a timeline, or say it is flexible.',
    'Give an industry.',
  ]) {
    await expect(page.getByText(message)).toBeVisible();
  }
  await expect(page.getByLabel('Title')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL('/intakes/new');

  // Editing a field clears its message without re-validating the rest.
  await page.getByLabel('Title').fill(INTAKE.title);
  await expect(page.getByText('Give the request a title.')).toHaveCount(0);
  await expect(page.getByText('Give an industry.')).toBeVisible();

  await page.getByLabel('Description').fill('Too short to triage.');
  await page.getByRole('button', { name: 'Create intake' }).click();
  await expect(
    page.getByText('Give at least 40 characters so the triage summary has something to work with.'),
  ).toBeVisible();

  expect(await db.intake.count()).toBe(0);
});

test('an intake that does not exist is a real 404', async ({ page }) => {
  const response = await page.goto('/intakes/does-not-exist');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'No intake with that id' })).toBeVisible();
});
