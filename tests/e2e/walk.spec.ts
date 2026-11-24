import { expect, test, type Page } from '@playwright/test';

/**
 * Tea walks through the demo flat in the 3D view: from the living room through the bedroom door, around the bed,
 * and back. Rings on the floor (with a label) lead into the next room; W A S D and the arrow pad walk inside a
 * room; she never ends up inside a wall or a piece of furniture.
 */
const standing = (page: Page) => page.evaluate(() => window.flatfit.viewer!.standing);
const tab = (page: Page) => page.locator('#views [aria-selected=true]');

/**
 * Look at the doorway that leads to `room` (as one turns towards a door) and check its label shows up there.
 * The bedroom door of the demo flat is in the wall x = 4, z 2.35–3.10.
 */
async function face(page: Page, room: string) {
  const spot = page.locator('.walk-spot', { hasText: room });
  await page.evaluate(() => {
    const v = window.flatfit.viewer!;
    v.lookAtPoint(v.camera.position.clone().set(4, 1.45, 2.72));
  });
  try {
    await expect(spot).toBeVisible({ timeout: 10_000 });
  } catch (e) {
    // what the camera and the labels were doing, for a failure on CI
    console.log(
      await page.evaluate(() => {
        const v = window.flatfit.viewer!;
        return JSON.stringify({
          standing: v.standing,
          interior: v.interior,
          labels: [...document.querySelectorAll<HTMLElement>('.walk-spot')].map(b => [b.textContent, b.hidden, b.style.transform]),
        });
      }),
    );
    throw e;
  }
  return spot;
}
/** Wait until the camera has finished walking, every leg of it. */
async function settle(page: Page) {
  await page.waitForTimeout(50);
  await expect.poll(() => page.evaluate(() => window.flatfit.viewer!.walking), { timeout: 10_000 }).toBe(false);
}

test.describe('Tea · walks through the flat', () => {
  test.use({ locale: 'en-GB' });
  test('goes from room to room through the doors and walks around inside, never through a wall', async ({ page }) => {
    await page.goto('./#c=rs&l=en');
    await expect(page.locator('body[data-ready="1"]')).toBeAttached({ timeout: 30_000 });
    await page.keyboard.press('1');
    await expect(tab(page)).toContainText('Living room');
    await expect(page.locator('.walk-spot', { hasText: 'Bedroom' })).toBeAttached();

    await (await face(page, 'Bedroom')).click();
    await settle(page);
    await expect(tab(page)).toContainText('Bedroom');
    const inBed = await standing(page);
    // the bedroom is x 4–7, z 0–3.2 in the demo flat
    expect(inBed.x).toBeGreaterThan(4.2);

    // walking on and on along the room stops at the wall
    for (const key of ['d', 'd', 'w', 'w', 'w', 'w', 'a', 's', 's']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
      await settle(page);
      const p = await standing(page);
      expect(p.x, key).toBeGreaterThan(4.2);
      expect(p.x, key).toBeLessThan(6.8);
      expect(p.z, key).toBeGreaterThan(0.2);
      expect(p.z, key).toBeLessThan(3.0);
    }

    // and back to the living room through the same door
    await (await face(page, 'Living room')).click();
    await settle(page);
    await expect(tab(page)).toContainText('Living room');
    expect((await standing(page)).x).toBeLessThan(4);
  });
});
