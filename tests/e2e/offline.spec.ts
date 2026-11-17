import { expect, test, type Page } from '@playwright/test';

const ready = async (page: Page) => {
  await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 });
};

test.describe('Goran · in a furniture store with no signal', () => {
  test.use({ locale: 'en-GB', serviceWorkers: 'allow' });
  test('the app, the catalogue and the shopping list open offline after one visit', async ({ page, context }) => {
    await page.goto('./#c=rs&l=en');
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    // the first visit ran before the worker took over: one more load goes through it and fills its cache
    await page.reload();
    await ready(page);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('total')).toContainText('RSD');
    await page.getByRole('button', { name: 'Shopping list by store' }).click();
    await expect(page.locator('#shop-dlg .shop-progress')).toContainText(/of \d+ bought/);
    await context.setOffline(false);
  });
});
