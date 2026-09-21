import { expect, gotoHydrated, INTAKE, test } from './fixtures';

test('a hard failure shows the banner, and a retry recovers', async ({ page, request, worker }) => {
  await worker.start({ FORCE_AI_FAILURE: 'terminal' });

  const created = await request.post('/api/intakes', { data: INTAKE });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  await gotoHydrated(page, `/intakes/${id}`);

  const banner = page.getByRole('main').getByRole('alert');
  await expect(banner).toContainText('Analysis failed', { timeout: 15_000 });
  await expect(banner).toContainText('Nothing was generated for it yet.');
  await expect(banner).toContainText('Tried 1 attempt.');
  await expect(page.getByText('FORCE_AI_FAILURE=terminal')).toBeVisible();

  // The fault is fixed and the worker redeployed; the retry button is how the user finds out.
  await worker.start();
  await page.getByRole('button', { name: 'Retry analysis' }).click();

  await expect(page.getByText(/^mock · prompt /)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('mock', { exact: true })).toBeVisible();
  await expect(page.getByText(`${INTAKE.title}. We want to forecast`)).toBeVisible();
});
