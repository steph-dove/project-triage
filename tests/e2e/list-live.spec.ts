import { db, expect, gotoHydrated, INTAKE, test } from './fixtures';

test('a card on the list updates itself when its analysis finishes', async ({ page, worker }) => {
  await db.intake.create({ data: { ...INTAKE, enrichment: { create: {} } } });

  await gotoHydrated(page, '/');
  const card = page.getByRole('link', { name: new RegExp(INTAKE.title) });
  await expect(card.getByText('Queued')).toBeVisible();

  // Started after the page is open, so the only way the card can change is the stream.
  await worker.start();

  await expect(card.getByText('mock', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Queued')).toHaveCount(0);
});
