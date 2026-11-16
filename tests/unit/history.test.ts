import { describe, expect, it } from 'vitest';
import { addDays, priceOn, priceStats, type Series } from '../../src/domain/history';

const S: Series = [
  ['2026-09-01', 500],
  ['2026-10-20', 450],
  ['2026-11-05', 520],
  ['2026-11-12', 399],
];
const TODAY = '2026-11-16';

describe('price history', () => {
  it('knows the price on any day', () => {
    expect(priceOn(S, '2026-08-31')).toBeUndefined();
    expect(priceOn(S, '2026-10-19')).toBe(500);
    expect(priceOn(S, '2026-11-05')).toBe(520);
    expect(addDays('2026-11-16', -30)).toBe('2026-10-17');
  });
  it('finds the 30-day low and says when today is at it', () => {
    const st = priceStats(S, TODAY, 399)!;
    expect(st.low30).toBe(399);
    expect(st.high30).toBe(520);
    expect(st.atLow30).toBe(true);
    expect(st.droppedFrom).toBe(520);
  });
  it('counts the price in force at the start of the window, not only changes inside it', () => {
    // 500 applied from 1 Sep until 20 Oct, so on 17 Oct (30 days back) it was 500
    const st = priceStats(S.slice(0, 2), TODAY, 450)!;
    expect(st.high30).toBe(500);
    expect(st.low30).toBe(450);
    expect(st.atLow30).toBe(true);
  });
  it('is not "lowest in 30 days" when the price never changed, or went up', () => {
    expect(priceStats([['2026-10-01', 300]], TODAY, 300)!.atLow30).toBe(false);
    const up = priceStats(S.slice(0, 3), TODAY, 520)!;
    expect(up.atLow30).toBe(false);
    expect(up.droppedFrom).toBeUndefined();
  });
  it('uses a price refreshed in the browser that is newer than the last commit', () => {
    const st = priceStats(S, TODAY, 380)!;
    expect(st.low30).toBe(380);
    expect(st.points.at(-1)).toEqual([TODAY, 380]);
  });
  it('draws the chart from the price in force on its first day', () => {
    const st = priceStats(S, TODAY, 399, 60)!;
    expect(st.points[0]).toEqual([addDays(TODAY, -60), 500]);
    expect(st.from).toBe(addDays(TODAY, -60));
  });
  it('has nothing to say without a history', () => {
    expect(priceStats(undefined, TODAY, 1)).toBeNull();
    expect(priceStats([], TODAY, 1)).toBeNull();
  });
});
