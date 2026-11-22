import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The 3D view compared with how it looked: three camera views of the demo flat, each reduced to a 32 × 20 grid of
 * average colours. A grid survives the small differences between machines and graphics drivers (anti-aliasing,
 * rounding), but a missing sofa, a wrong colour, a camera in the wrong place or a black view changes many cells.
 * The HTML labels are left out: the image comes from the WebGL canvas itself.
 *
 * After a change to the 3D view that is meant: FLATFIT_UPDATE_VISUAL=1 npx playwright test visual, then npx biome format --write tests/e2e/fixtures
 */
const BASELINE = 'tests/e2e/fixtures/scene-grid.json';
const W = 32,
  H = 20;
/** a cell counts as changed when one of its colour channels moved by more than this (0–255) */
const CELL = 24;
/**
 * At most this share of cells may change, and the average change must stay below MEAN. The same machine gives
 * exactly the same grid; a living room without its sofa changes 5.9 % of cells (average 4.4), about three times the limit.
 */
const SHARE = 0.02,
  MEAN = 2.5;

type Grid = number[];
const grid = (page: Page) =>
  page.evaluate(
    ([w, h]) => {
      const big = document.createElement('canvas');
      window.flatfit.viewer!.snapshot(big);
      const small = document.createElement('canvas');
      small.width = w;
      small.height = h;
      const g = small.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(big, 0, 0, w, h);
      return Array.from(g.getImageData(0, 0, w, h).data).filter((_, i) => i % 4 !== 3);
    },
    [W, H],
  );
const compare = (a: Grid, b: Grid) => {
  let sum = 0,
    changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    sum += d;
    if (d > CELL) changed++;
  }
  const cells = a.length / 3;
  return { mean: sum / cells, share: changed / cells };
};

const VIEWS = [
  { name: 'whole flat', id: 'overview' },
  { name: 'living room', id: 'living' },
  { name: 'bedroom', id: 'bedroom' },
];

test.describe('3D view, compared with the stored picture', () => {
  test.use({ locale: 'en-GB' });
  test('the demo flat looks as it did in three camera views, and a missing sofa is noticed', async ({ page }) => {
    await page.goto('./#c=rs&l=en');
    await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 });
    // the decorative models load lazily; wait for them so every run draws the same scene
    await page.evaluate(async () => {
      await window.flatfit.models.load('./');
      window.flatfit.rebuild();
    });
    const shoot = async (id: string) => {
      await page.evaluate(id => {
        const app = window.flatfit;
        app.setView(
          app.views.findIndex(v => v.id === id),
          true,
          true,
        );
      }, id);
      await page.waitForTimeout(300);
      return grid(page);
    };
    const now: Record<string, Grid> = {};
    for (const v of VIEWS) now[v.id] = await shoot(v.id);

    if (process.env.FLATFIT_UPDATE_VISUAL) {
      fs.writeFileSync(BASELINE, JSON.stringify({ w: W, h: H, note: 'tests/e2e/visual.spec.ts', views: now }) + '\n');
      return;
    }
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { views: Record<string, Grid> };
    for (const v of VIEWS) {
      const r = compare(now[v.id], base.views[v.id]);
      const why = `${v.name}: ${(r.share * 100).toFixed(1)} % of cells changed, average change ${r.mean.toFixed(1)}`;
      expect(r.share, why).toBeLessThanOrEqual(SHARE);
      expect(r.mean, why).toBeLessThanOrEqual(MEAN);
    }

    // the check must be able to fail: take the sofa away and the living room no longer matches
    await page.evaluate(() => {
      const app = window.flatfit;
      app.applySelection({ ...app.sel, sofa: '' });
    });
    await page.waitForTimeout(300);
    const without = compare(await shoot('living'), base.views.living);
    expect(without.share, `living room without the sofa: ${(without.share * 100).toFixed(1)} % changed`).toBeGreaterThan(SHARE);
  });
});
