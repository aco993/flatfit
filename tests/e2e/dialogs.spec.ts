import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Every dialog added for the shopping trip passes an accessibility scan while it is open, and closes with Escape.
 */
const ready = async (page: Page) => {
  await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 });
};
const serious = async (page: Page, selector: string) => {
  const scan = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa']).analyze();
  return scan.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(
      v =>
        `${v.id}: ${v.nodes
          .map(n => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
};

test.describe('Mira · opens every dialog with a screen reader', () => {
  test.use({ locale: 'en-GB' });
  test('shopping list, payback, walls and floor, own product: no serious accessibility problem', async ({ page }) => {
    await page.goto('./#c=rs&l=en');
    await ready(page);
    const dialogs: [string, string, () => Promise<void>][] = [
      ['Shopping list by store', '#shop-dlg', async () => {}],
      ['Payback for landlords', '#payback-dlg', async () => {}],
      ['Walls and floor', '#finish-dlg', async () => {}],
    ];
    for (const [button, id] of dialogs) {
      await page.getByRole('button', { name: button }).click();
      const d = page.locator(id);
      await expect(d).toBeVisible();
      expect(await serious(page, id), id).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(d).toBeHidden();
    }
    await page.locator('#slot-sofa label').click();
    await page.locator('#card').getByRole('button', { name: 'Add a product from another store' }).click();
    await expect(page.locator('#own-dlg')).toBeVisible();
    expect(await serious(page, '#own-dlg')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#own-dlg')).toBeHidden();
  });
});
