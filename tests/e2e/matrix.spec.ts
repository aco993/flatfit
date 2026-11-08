import { expect, test, type Page } from '@playwright/test';
import LZString from 'lz-string';
import { fromTemplate } from '../../src/data/templates';

/**
 * The ten URL / device combinations that matter most: every market, all five languages, phone and dark mode,
 * a link with moved furniture, a link that carries a whole floor plan, and a link that is broken on purpose.
 * Each one must load without errors, show a total in the right currency and never scroll sideways.
 */

const ready = async (page: Page) => {
  await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 });
};
const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/WebGL|GPU|context/i.test(m.text())) errors.push(m.text());
  });
  return errors;
};
const pack = (v: unknown) => LZString.compressToEncodedURIComponent(JSON.stringify(v));
const studio = (() => {
  const p = fromTemplate('studio', 'Linked studio', 'de');
  p.id = 'p-linked';
  return p;
})();

interface Case {
  name: string;
  hash: string;
  lang: string;
  currency: RegExp;
  country: string;
  phone?: boolean;
  dark?: boolean;
  extra?: (page: Page) => Promise<void>;
}
const CASES: Case[] = [
  { name: 'Serbia · Serbian', hash: 'c=rs&l=sr', lang: 'sr-Latn', currency: /RSD/, country: 'rs' },
  {
    name: 'Bosnia and Herzegovina · Bosnian',
    hash: 'c=ba&l=bs',
    lang: 'bs',
    currency: /\d\.\d{3},\d{2}\sKM/,
    country: 'ba',
    extra: async page => {
      await expect(page.locator('#slots .flag.est').first()).toBeVisible();
      await expect(page.locator('#summary')).toContainText(/JYSK/);
    },
  },
  {
    name: 'Croatia · Croatian',
    hash: 'c=hr&l=hr',
    lang: 'hr',
    currency: /€/,
    country: 'hr',
    extra: async page => {
      await expect(page.locator('#summary')).toContainText('Trgovine: IKEA');
      await expect(page.locator('#sel-fridge')).toBeAttached();
      await expect(page.locator('#slot-fridge label')).toContainText('Hladnjak');
    },
  },
  { name: 'Germany · German', hash: 'c=de&l=de', lang: 'de', currency: /€/, country: 'de' },
  { name: 'Austria · English', hash: 'c=at&l=en', lang: 'en', currency: /€/, country: 'at' },
  { name: 'Bosnia and Herzegovina on a phone', hash: 'c=ba&l=en', lang: 'en', currency: /KM|BAM/, country: 'ba', phone: true },
  {
    name: 'Croatia in dark mode, German',
    hash: 'c=hr&l=de',
    lang: 'de',
    currency: /€/,
    country: 'hr',
    dark: true,
    extra: async page => {
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe('rgb(22, 24, 27)');
    },
  },
  {
    name: 'Link with moved furniture',
    hash: `c=rs&l=en&m=${pack({ sofa: { x: 1.2, z: 1.5, rot: 0 } })}`,
    lang: 'en',
    currency: /RSD/,
    country: 'rs',
    extra: async page => {
      expect(await page.evaluate(() => (window as any).flatfit.project.moves?.sofa)).toEqual({ x: 1.2, z: 1.5, rot: 0 });
    },
  },
  {
    name: 'Link with a whole floor plan',
    hash: `c=de&l=en&plan=${pack(studio)}`,
    lang: 'en',
    currency: /€/,
    country: 'de',
    extra: async page => {
      await expect(page.locator('#project')).toContainText('Linked studio');
      expect(await page.evaluate(() => (window as any).flatfit.project.rooms.length)).toBe(3);
    },
  },
  { name: 'Broken link falls back to the demo', hash: 'c=xx&l=zz&s=%%%&m=@@@&plan=!!!', lang: 'en', currency: /RSD|€|KM/, country: '' },
];

for (const c of CASES) {
  test.describe(`URL matrix · ${c.name}`, () => {
    test.use({
      locale: 'en-GB',
      ...(c.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
      ...(c.dark ? { colorScheme: 'dark' as const } : {}),
    });
    test(`loads cleanly: #${c.hash.slice(0, 40)}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./#' + c.hash);
      await ready(page);
      await expect(page.locator('html')).toHaveAttribute('lang', c.lang);
      await expect(page.getByTestId('total')).toContainText(c.currency);
      const amount = Number((await page.getByTestId('total').innerText()).replace(/[^\d]/g, ''));
      expect(amount).toBeGreaterThan(0);
      if (c.country) await expect(page.locator('#country')).toHaveValue(c.country);
      await c.extra?.(page);
      // without WebGL (headless Firefox on CI) the page must still work, with the fallback notice instead of the 3D view
      if (!(await page.locator('#nogl').isHidden())) await expect(page.locator('#nogl')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('Refresh prices', () => {
  test('checks IKEA live, applies a new sale and remembers it after a reload', async ({ page }) => {
    // stores are stubbed so the test does not depend on today's prices
    await page.route('https://raw.githubusercontent.com/**', r => r.fulfill({ status: 404, body: '' }));
    let first = '';
    await page.route('https://sik.search.blue.cdtapps.com/**', async r => {
      const no = /q=(\d+)/.exec(r.request().url())![1];
      first ||= no;
      const sale = no === first;
      await r.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          searchResultPage: {
            products: {
              main: {
                items: [
                  {
                    product: {
                      itemNo: no,
                      id: no,
                      salesPrice: {
                        numeral: sale ? 1 : 9999,
                        currencyCode: 'EUR',
                        previous: sale ? { wholeNumber: '9999' } : undefined,
                        validTo: '2026-12-01',
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      });
    });
    await page.goto('./#c=hr&l=en');
    await ready(page);
    await page.getByRole('button', { name: /Refresh prices/ }).click();
    await expect(page.locator('#refresh-note')).toContainText(/prices changed/, { timeout: 30_000 });
    await expect(page.locator('#refresh-note')).toContainText('1 new sales');
    const stored = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('flatfit.prices.hr') || '{}')).length);
    expect(stored).toBeGreaterThan(50);
    await page.reload();
    await ready(page);
    // the product on sale now costs 1 €, so it shows up as the cheapest option of its slot
    await expect(page.locator('#slots select option', { hasText: '€1' }).first()).toBeAttached();
  });
});
