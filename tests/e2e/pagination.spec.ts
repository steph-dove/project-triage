import { expect, gotoHydrated, seedIntakes, test, waitForHydration } from './fixtures';

test('page 2 lives in the URL and survives a reload', async ({ page }) => {
  await seedIntakes(14);

  await gotoHydrated(page, '/');
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await expect(page.getByText('Showing 1–10 of 14')).toBeVisible();
  // Rendered as plain text at the ends, not as a link to nowhere.
  await expect(page.getByRole('link', { name: 'Previous' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL('/?page=2');
  await expect(page.getByText('Showing 11–14 of 14')).toBeVisible();

  const cards = page.getByRole('link', { name: /Seeded intake/ });
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toContainText('Seeded intake 3');

  await page.reload();
  await waitForHydration(page);
  await expect(page).toHaveURL('/?page=2');
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toContainText('Seeded intake 3');
  await expect(page.getByRole('link', { name: 'Next' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Previous' }).click();
  await expect(page).toHaveURL('/');
  await expect(cards).toHaveCount(10);
});

test('a page past the end goes back to the first one', async ({ page }) => {
  await seedIntakes(3);

  await gotoHydrated(page, '/?page=99');

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: /Seeded intake/ })).toHaveCount(3);
});
