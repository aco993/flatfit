import { expect, test, type Page } from '@playwright/test';

/**
 * Vesna furnishes the flat she rents out: she starts from the introduction's cheapest offer, adds a sofa she found
 * second hand, and ticks off what she has bought on her shopping trip. Prices change, so totals are compared with
 * each other rather than hard-coded.
 */
const ready = async (page: Page) => {
  await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 });
};
const num = (s: string) =>
  Number(
    s
      .replace(/[^\d,.]/g, '')
      .replace(/[.,](?=\d{3}\b)/g, '')
      .replace(',', '.'),
  );

test.describe('Vesna · furnishes a flat to rent out, on a budget', () => {
  test.use({ locale: 'en-GB' });
  test('starts from the cheapest offer, adds a second-hand sofa and ticks off her shopping', async ({ page }) => {
    await page.goto('./#c=rs&l=en');
    await ready(page);

    // the introduction says what FlatFit does and offers the cheapest setup that fits, with its total
    const intro = page.locator('#intro');
    await expect(intro).toBeVisible();
    const offer = intro.getByRole('button', { name: /Cheapest setup that fits/ });
    await expect(offer).toBeVisible({ timeout: 20_000 });
    const offered = num(await offer.innerText());
    await offer.click();
    await expect(intro).toBeHidden();
    await expect(page.getByRole('button', { name: 'Cheapest that fits' })).toHaveAttribute('aria-pressed', 'true');
    expect(num(await page.getByTestId('total').innerText())).toBe(offered);

    // a sofa from somewhere else: it joins the 3D view, the fit check and the total
    await page.locator('#slot-sofa label').click();
    await page.locator('#card').getByRole('button', { name: 'Add a product from another store' }).click();
    const form = page.locator('#own-dlg');
    await form.getByLabel('Name', { exact: true }).fill('Second-hand sofa');
    await form.getByLabel(/^Price/).fill('9000');
    await form.getByLabel('Width').fill('190');
    await form.getByLabel('Depth').fill('90');
    await form.getByLabel('Height').fill('80');
    await form.getByRole('button', { name: 'Add and use it' }).click();
    await expect(page.locator('#sel-sofa option:checked')).toContainText('Second-hand sofa');
    await expect(page.locator('#sel-sofa option:checked')).toContainText('My products');

    // the shopping trip: tick two items, close, reload, the ticks are still there
    await page.getByRole('button', { name: 'Shopping list by store' }).click();
    const list = page.locator('#shop-dlg');
    await expect(list.getByRole('heading', { name: 'My products' })).toBeVisible();
    const progress = list.locator('.shop-progress');
    const leftBefore = num((await progress.innerText()).split('left to pay')[1]);
    await list.getByRole('checkbox').nth(0).check();
    await list.getByRole('checkbox').nth(1).check();
    await expect(progress).toContainText(/^2 of \d+ bought/);
    expect(num((await progress.innerText()).split('left to pay')[1])).toBeLessThan(leftBefore);
    await list.getByRole('button', { name: 'Close' }).click();

    await page.reload();
    await ready(page);
    // the introduction stays closed once it was used
    await expect(page.locator('#intro')).toBeHidden();
    await page.getByRole('button', { name: 'Shopping list by store' }).click();
    await expect(page.locator('#shop-dlg .shop-progress')).toContainText(/^2 of \d+ bought/);
    await expect(page.locator('#shop-dlg input:checked')).toHaveCount(2);
    await page.locator('#shop-dlg').getByRole('button', { name: 'Close' }).click();

    // does furnishing pay? 45,000 a month furnished, 38,000 empty
    await page.getByRole('button', { name: 'Payback for landlords' }).click();
    const pay = page.locator('#payback-dlg');
    await pay.getByLabel(/furnished/).fill('45000');
    await pay.getByLabel(/empty/).fill('38000');
    await expect(pay.locator('.pay-out')).toContainText(/Paid back after \d+ months/);
    await expect(pay.locator('.pay-out')).toContainText('Wears out first');
    await pay.getByRole('button', { name: 'Close' }).click();

    // paint and laminate for the walls and floors of the plan, and a wall colour in 3D
    await page.getByRole('button', { name: 'Walls and floor' }).click();
    const fin = page.locator('#finish-dlg');
    await expect(fin).toContainText(/Paint: about \d+ l/);
    await expect(fin).toContainText(/Laminate: [\d.,]+ m²/);
    await fin.locator('[data-wall]').nth(3).click();
    await expect(fin.locator('[data-wall]').nth(3)).toHaveAttribute('aria-pressed', 'true');
  });
});
