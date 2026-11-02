import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Each test plays one kind of user end to end. They run against the production build (vite preview).
 * Prices change, so the tests compare totals with each other instead of hard-coding amounts.
 */

const ready = async (page: Page) => { await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 }); };
const total = async (page: Page) => (await page.getByTestId('total').innerText()).replace(/[^\d,.]/g, '');
const num = (s: string) => Number(s.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));

test.describe('Ana · renter in Novi Sad, on her phone, Serbian @phone', () => {
  test.use({ locale: 'sr-RS' });
  test('picks the cheapest look, checks a product and its store link', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sr-Latn');
    await expect(page.getByRole('heading', { name: /Gotovi stilovi/i })).toBeVisible();
    await expect(page.getByTestId('total')).toContainText('RSD');
    const before = num(await total(page));
    await page.getByRole('button', { name: 'Najjeftinije što staje' }).click();
    await expect(page.getByRole('button', { name: 'Najjeftinije što staje' })).toHaveAttribute('aria-pressed', 'true');
    const after = num(await total(page));
    expect(after).toBeLessThan(before);
    // the cheapest proposal never contains a piece that does not fit
    await expect(page.getByTestId('issues').locator('li.hard')).toHaveCount(0);
    await page.getByRole('tab', { name: /Spavaća soba/ }).click();
    await page.locator('#slot-bed label').click();
    const card = page.locator('#card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: /Otvori u radnji/ })).toHaveAttribute('href', /^https:\/\//);
    // nothing on the page is wider than the phone
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Jonas · Berlin, desktop, German', () => {
  test.use({ locale: 'de-DE' });
  test('switches to Germany, swaps the sofa and shares the setup', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./');
    await ready(page);
    await expect(page.getByText('Fertige Looks')).toBeVisible();
    await page.getByLabel('Land').selectOption('de');
    await expect(page.getByTestId('total')).toContainText('€');
    // every store link of the German catalogue goes to IKEA Germany or a price comparison
    const hrefs = await page.locator('#slots a[href^="http"]').evaluateAll(as => as.map(a => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThan(10);
    for (const h of hrefs) expect(h).toMatch(/ikea\.com\/de\/de\/|idealo\.de/);
    const t1 = await total(page);
    const sofa = page.locator('#sel-sofa');
    const options = await sofa.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value));
    await sofa.selectOption(options[options.length - 1]);
    await expect(page.getByRole('button', { name: 'Deine Auswahl' }).or(page.locator('.summary', { hasText: 'Deine Auswahl' }))).toBeVisible();
    const t2 = await total(page);
    expect(t2).not.toBe(t1);
    await page.getByRole('button', { name: /Link zu dieser Auswahl/ }).click();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain('c=de');
    const other = await context.newPage();
    await other.goto(url);
    await ready(other);
    await expect(other.getByTestId('total')).toHaveText(await page.getByTestId('total').innerText());
  });
});

test.describe('Mira · uses only the keyboard and a screen reader', () => {
  test.use({ locale: 'en-GB' });
  test('reaches everything by keyboard and the page passes an accessibility scan', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the shopping list' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#list')).toBeFocused();
    await page.locator('body').press('2');
    await expect(page.getByRole('tab').nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.locator('body').press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await page.locator('body').press('l');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.locator('body').press('l');
    await page.locator('body').press('l');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('#viewer canvas').analyze();
    const serious = scan.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  });
});

test.describe('Luka · landlord adding his own flat', () => {
  test.use({ locale: 'en-GB' });
  test('draws a studio, adds a bedroom, saves, exports and deletes it', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.locator('#project').selectOption('__new');
    const ed = page.getByRole('dialog', { name: 'Floor plan' });
    await expect(ed).toBeVisible();
    await ed.getByRole('button', { name: /Studio/ }).click();
    await ed.getByLabel('Apartment name').fill('Studio test');
    await ed.getByRole('button', { name: '+ Add room' }).click();
    await ed.getByLabel('Room type').selectOption('bedroom');
    // the new room is selected: move it with the keyboard and check the plan has no errors
    await ed.locator('#ed-svg .room.sel').focus();
    await page.keyboard.press('ArrowRight');
    await expect(ed.locator('#ed-problems li')).toHaveCount(0);
    await ed.getByRole('button', { name: 'Save and show in 3D' }).click();
    await expect(ed).toBeHidden();
    await expect(page.locator('#project')).toHaveValue(/^p-/);
    await expect(page.getByRole('tab', { name: /Bedroom/ })).toBeVisible();
    await expect(page.locator('#slot-bed')).toBeVisible();
    // the plan survives a reload
    await page.reload(); await ready(page);
    await expect(page.locator('#project option:checked')).toHaveText('Studio test');
    await page.locator('#project').selectOption('__manage');
    const dlg = page.getByRole('dialog', { name: 'My apartments' });
    const dl = page.waitForEvent('download');
    await dlg.getByRole('button', { name: 'Export (JSON)' }).click();
    expect((await dl).suggestedFilename()).toBe('Studio_test.json');
    page.once('dialog', d => d.accept());
    await dlg.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#project option:checked')).toHaveText(/Demo/);
  });
});

test.describe('Petra · old laptop, starts a photoreal render and changes her mind', () => {
  test.use({ locale: 'en-GB' });
  test('the render can be cancelled at any moment and the page stays usable', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.getByRole('button', { name: 'Photoreal render' }).click();
    const dlg = page.getByRole('dialog', { name: 'Photoreal render' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel(/Fast/).check();
    await dlg.getByRole('button', { name: 'Start' }).click();
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.locator('#pt-status')).toContainText(/Preparing|Tracing/, { timeout: 30_000 });
    const t0 = Date.now();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#pt-status')).toHaveText('Cancelled.', { timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(15_000);
    await expect(dlg.getByRole('button', { name: /Start|Render again/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await page.getByRole('tab', { name: /Living room/ }).click();
    await expect(page.getByRole('tab', { name: /Living room/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Shopping list export', () => {
  test.use({ locale: 'en-GB' });
  test('CSV has one row per item to buy with links', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download shopping list/ }).click();
    const file = await (await dl).path();
    const text = (await import('node:fs')).readFileSync(file!, 'utf8');
    const rows = text.trim().split(/\r?\n/);
    expect(rows[0]).toContain('Unit price');
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.slice(1).every(r => /https:\/\//.test(r))).toBe(true);
  });
});

test.describe('Sara · rearranges the living room with the mouse', () => {
  test.use({ locale: 'en-GB' });
  test('drags the sofa, sees what it hits, turns it, and undoes it all', async ({ page }) => {
    await page.goto('./#c=rs&l=en');
    await ready(page);
    await page.getByRole('tab', { name: /Whole flat/ }).click();
    await page.waitForTimeout(900);
    const at = (x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as any).flatfit.viewer.toScreen(x, y, z), [x, y, z]);
    const centre = await page.evaluate(() => { const c = (window as any).flatfit.viewer.slotCenter('sofa'); return [c.x, c.z]; });
    // wait until the camera has stopped moving (software GL on CI animates slowly)
    let s = await at(centre[0], 0.35, centre[1]);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(150);
      const n = await at(centre[0], 0.35, centre[1]);
      const still = Math.hypot(n.x - s.x, n.y - s.y) < 0.5; s = n;
      if (still) break;
    }
    // first click selects, then the selected piece can be dragged
    await page.mouse.click(s.x, s.y);
    await expect(page.locator('#card h3')).toHaveText('Sofa');
    await expect(page.locator('#card')).toContainText('Drag it in the 3D view');
    const s0 = await at(centre[0], 0, centre[1]), t = await at(centre[0] + 1.2, 0, centre[1]);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x + (t.x - s0.x) / 2, s.y + (t.y - s0.y) / 2, { steps: 6 });
    expect(await page.evaluate(() => (window as any).flatfit.viewer.dragging)).toBe(true);
    await page.mouse.move(s.x + (t.x - s0.x), s.y + (t.y - s0.y), { steps: 6 });
    await page.mouse.up();
    // pushed into the middle of the room it runs into the coffee table
    await expect(page.getByTestId('issues')).toContainText(/Sofa: Runs \d+ cm into: Coffee table/);
    await expect(page.locator('#card')).toContainText('Back to suggested place');
    await page.keyboard.press('t');
    const turned = await page.evaluate(() => (window as any).flatfit.project.moves.sofa.rot);
    expect(Math.abs(turned)).toBeLessThan(0.01 + Math.PI);
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('issues')).not.toContainText('Sofa:');
    expect(await page.evaluate(() => Object.keys((window as any).flatfit.project.moves || {}).length)).toBe(0);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('issues')).toContainText('Sofa:');
  });
});

test.describe('Nina · has only a picture of her floor plan', () => {
  test.use({ locale: 'en-GB' });
  test('loads the picture, sets its scale from a known wall and draws a room over it', async ({ page }) => {
    await page.goto('./#c=de&l=en');
    await ready(page);
    await page.locator('#project').selectOption('__new');
    const dlg = page.getByRole('dialog', { name: 'Floor plan' });
    await dlg.getByRole('button', { name: /Empty/ }).click();
    await dlg.locator('#ed-bd-file').setInputFiles('tests/e2e/fixtures/plan.png');
    await expect(dlg.getByRole('status')).toContainText('Click two points');
    // the 8 m dimension line runs from pixel (100,120) to (900,120) of the 1000 px wide picture
    const toScreen = (px: number, py: number) => page.evaluate(([px, py]) => {
      const svg = document.getElementById('ed-svg') as unknown as SVGSVGElement, img = svg.querySelector('image')!;
      const x = +img.getAttribute('x')!, y = +img.getAttribute('y')!, w = +img.getAttribute('width')!, h = +img.getAttribute('height')!;
      const p = svg.createSVGPoint(); p.x = x + px / 1000 * w; p.y = y + py / 700 * h;
      const q = p.matrixTransform(svg.getScreenCTM()!); return { x: q.x, y: q.y };
    }, [px, py]);
    const a = await toScreen(100, 120), b = await toScreen(900, 120);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await dlg.getByLabel('Real distance (m)').fill('8');
    await dlg.getByRole('button', { name: 'Apply scale' }).click();
    // 1000 px at 100 px per metre is 10 m
    const width = Number(await dlg.getByLabel('Image width (m)').inputValue());
    expect(Math.abs(width - 10)).toBeLessThan(0.15);
    // the room drawn to the picture's living room (5 × 4.5 m) matches its outline
    await dlg.locator('[data-f="w"]').fill('5');
    await dlg.locator('[data-f="d"]').fill('4.5');
    await expect(dlg.locator('#ed-total')).toContainText('22.5');
    await dlg.getByRole('button', { name: 'Save and show in 3D' }).click();
    await ready(page);
    // the picture stays with the flat but never goes into a share link
    const shared = await page.evaluate(() => (window as any).flatfit.shareUrl());
    expect(shared.length).toBeLessThan(4000);
  });
});
