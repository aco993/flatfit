import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * "Describe what you want": the sentence goes to the model, the model answers with settings only, and FlatFit's own
 * planner fills the list with real products. Gemini is answered here by a stand-in, so no key and no network.
 */
const ready = async (page: Page) => {
  await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 });
};
const money = (s: string) => Number(s.replace(/[^\d]/g, ''));

test.describe('Vesna · tells the AI stylist what she wants', () => {
  test.use({ locale: 'en-GB' });
  test('a sentence becomes a setup from the catalogue, within the budget, with a sofa bed', async ({ page }) => {
    let sent: { headers: Record<string, string>; body: string } | null = null;
    await page.route('https://generativelanguage.googleapis.com/**', async route => {
      const req = route.request();
      sent = { headers: req.headers(), body: req.postData() || '' };
      const brief = {
        style: 'warm',
        budget: 320000,
        include: ['tv'],
        exclude: ['hooks'],
        sofaBed: true,
        note: 'Warm Japandi look with a sofa bed, under 320,000 RSD.',
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(brief) }] } }] }),
      });
    });
    await page.goto('./#c=rs&l=en');
    await ready(page);
    await page.getByRole('button', { name: /Describe what you want/ }).click();
    const d = page.locator('#stylist-dlg');
    await expect(d).toBeVisible();
    const scan = await new AxeBuilder({ page }).include('#stylist-dlg').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(scan.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);

    await d.getByLabel(/Your wish/).fill('Calm and warm, for renting to couples, under 320,000 dinars, guests can sleep on the sofa');
    await d.getByLabel(/Gemini/).check();
    await d.locator('input[name="key"]').fill('test-key-not-real');
    await d.getByRole('button', { name: 'Furnish it' }).click();
    await expect(d.locator('.sty-out')).toContainText('Furnished from the catalogue', { timeout: 15_000 });
    await expect(d.locator('.sty-out')).toContainText('Warm Japandi');

    // the key went in a header, never in the URL; the wish and the schema went in the body
    expect(sent).not.toBeNull();
    expect(sent!.headers['x-goog-api-key']).toBe('test-key-not-real');
    expect(sent!.body).toContain('guests can sleep on the sofa');
    expect(sent!.body).toContain('responseJsonSchema');

    const total = money((await d.locator('.sty-out').innerText()).match(/catalogue: ([^.]+\d)/)![1]);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(320000);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    const chosen = (slot: string) =>
      page.locator('#slot-' + slot + ' select').evaluate((e: HTMLSelectElement) => e.selectedOptions[0]?.text || '');
    expect(await chosen('sofa')).toMatch(/ležaj|razvla/i);
    expect(await chosen('hooks')).toMatch(/none/);
  });

  test('an answer that is not usable changes nothing', async ({ page }) => {
    await page.route('https://generativelanguage.googleapis.com/**', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"style":"baroque"}' }] } }] }),
      }),
    );
    await page.goto('./#c=rs&l=en');
    await ready(page);
    const before = await page.locator('#summary').innerText();
    await page.getByRole('button', { name: /Describe what you want/ }).click();
    const d = page.locator('#stylist-dlg');
    await d.getByLabel(/Your wish/).fill('something nice');
    await d.getByLabel(/Gemini/).check();
    await d.locator('input[name="key"]').fill('test-key-not-real');
    await d.getByRole('button', { name: 'Furnish it' }).click();
    await expect(d.locator('.sty-out')).not.toHaveText(/Thinking/, { timeout: 15_000 });
    await expect(d.locator('.sty-out')).not.toContainText('Furnished from the catalogue');
    await page.keyboard.press('Escape');
    expect(await page.locator('#summary').innerText()).toBe(before);
  });
});
