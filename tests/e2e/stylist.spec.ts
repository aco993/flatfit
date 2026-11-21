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
  test('a sentence becomes a setup from the catalogue, then a follow-up changes only what it names', async ({ page }) => {
    const sent: { headers: Record<string, string>; body: string }[] = [];
    const answers = [
      {
        style: 'warm',
        budget: 320000,
        include: ['tv'],
        exclude: ['hooks'],
        sofaBed: true,
        note: 'Warm Japandi look with a sofa bed, under 320,000 RSD.',
      },
      {
        style: 'warm',
        budget: null,
        include: ['tv'],
        exclude: ['hooks'],
        sofaBed: true,
        keep: [],
        only: ['coffee'],
        direction: 'other',
        note: 'Another coffee table; everything else stays.',
      },
    ];
    await page.route('https://generativelanguage.googleapis.com/**', async route => {
      const req = route.request();
      sent.push({ headers: req.headers(), body: req.postData() || '' });
      const brief = answers[Math.min(sent.length, answers.length) - 1];
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
    const log = d.getByRole('region', { name: 'Conversation with the stylist' });
    await expect(log).toContainText('Furnished from the catalogue', { timeout: 15_000 });
    await expect(log).toContainText('Warm Japandi');

    // the key went in a header, never in the URL; the wish and the schema went in the body
    expect(sent[0].headers['x-goog-api-key']).toBe('test-key-not-real');
    expect(sent[0].body).toContain('guests can sleep on the sofa');
    expect(sent[0].body).toContain('responseJsonSchema');
    const total = money((await log.innerText()).match(/catalogue: ([^.]+\d)/)![1]);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(320000);

    // a follow-up: the model hears what was said before and what the list holds; only the coffee table changes
    const picks = () =>
      page.evaluate(() =>
        Object.fromEntries([...document.querySelectorAll<HTMLSelectElement>('#slots select')].map(s => [s.closest('.slot')!.id, s.value])),
      );
    const before = await picks();
    await d.getByLabel('What should change?').fill('Another coffee table');
    await d.getByRole('button', { name: 'Change it' }).click();
    await expect(log).toContainText('Another coffee table; everything else stays.', { timeout: 15_000 });
    expect(sent[1].body).toContain('This is a follow-up');
    expect(sent[1].body).toContain('guests can sleep on the sofa');
    expect(sent[1].body).toMatch(/coffee: [^;]+RSD/);
    await expect(log.locator('.sty-diff li')).toHaveCount(1);
    await expect(log.locator('.sty-diff')).toContainText('Coffee table');
    const after = await picks();
    expect(Object.keys(after).filter(k => after[k] !== before[k])).toEqual(['slot-coffee']);

    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    const chosen = (slot: string) =>
      page.locator('#slot-' + slot + ' select').evaluate((e: HTMLSelectElement) => e.selectedOptions[0]?.text || '');
    expect(await chosen('sofa')).toMatch(/ležaj|razvla/i);
    expect(await chosen('hooks')).toMatch(/none/);
  });

  test('with a Claude key the stylist asks the small model for the settings only', async ({ page }) => {
    let body: Record<string, unknown> = {};
    await page.route('https://api.anthropic.com/**', async route => {
      body = JSON.parse(route.request().postData() || '{}');
      const brief = {
        style: 'light',
        budget: null,
        include: [],
        exclude: [],
        sofaBed: false,
        keep: [],
        only: [],
        direction: 'other',
        note: 'Light and simple.',
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: JSON.stringify(brief) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });
    });
    await page.goto('./#c=rs&l=en');
    await ready(page);
    await page.getByRole('button', { name: /Describe what you want/ }).click();
    const d = page.locator('#stylist-dlg');
    await d.getByLabel(/Your wish/).fill('light and simple');
    await d.getByLabel(/Claude/).check();
    await d.locator('input[name="key"]').fill('sk-ant-test-not-real');
    await d.getByRole('button', { name: 'Furnish it' }).click();
    await expect(d.getByRole('region', { name: 'Conversation with the stylist' })).toContainText('Light and simple.', { timeout: 15_000 });
    expect(body.model).toBe('claude-haiku-5-5');
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
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
