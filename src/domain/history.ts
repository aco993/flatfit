/**
 * Price history of one product, read from the daily price commits (scripts/history.mjs): one [date, price] entry
 * per change, oldest first. Pure functions, so the rules are unit-tested without a browser.
 */
export type Series = [string, number][];

export interface PriceStats {
  /** lowest price in the last 30 days, and the last day it was that low */
  low30: number;
  low30Date: string;
  /** highest price in the last 30 days */
  high30: number;
  /** the price today is the lowest of the last 30 days, and it was higher at some point in them */
  atLow30: boolean;
  /** the price before the latest change, when that change was a drop within the last 30 days */
  droppedFrom?: number;
  /** step points for a chart of the last `days` days: price from each date on */
  points: Series;
  /** first day of the chart */
  from: string;
}

const day = 864e5;
export const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * day).toISOString().slice(0, 10);

/** The price that applied on a date: the last change on or before it (undefined before the first one). */
export function priceOn(s: Series, date: string): number | undefined {
  let v: number | undefined;
  for (const [d, p] of s) {
    if (d > date) break;
    v = p;
  }
  return v;
}

/**
 * Lowest and highest price over the last 30 days, and whether today's price is the lowest of them. `current` is the
 * price the app shows now (a price refreshed in the browser can be newer than the last commit).
 */
export function priceStats(s: Series | undefined, today: string, current: number, days = 90): PriceStats | null {
  if (!s?.length) return null;
  const from30 = addDays(today, -30);
  // prices in force at some point in the window: the one at its start, every change in it, and today's
  const start = priceOn(s, from30);
  const inWindow = [...(start !== undefined ? [[from30, start] as [string, number]] : []), ...s.filter(([d]) => d > from30 && d <= today)];
  inWindow.push([today, current]);
  let low30 = Infinity,
    low30Date = today,
    high30 = -Infinity;
  for (const [d, p] of inWindow) {
    if (p < low30 || (p === low30 && d > low30Date)) {
      low30 = p;
      low30Date = d;
    }
    if (p > high30) high30 = p;
  }
  const last = s.filter(([d]) => d <= today);
  const prev = last.length > 1 ? last.at(-2)![1] : undefined;
  const lastDate = last.at(-1)?.[0];
  const droppedFrom = prev !== undefined && lastDate !== undefined && lastDate > from30 && current < prev ? prev : undefined;
  const from = addDays(today, -days);
  const startChart = priceOn(s, from);
  const points: Series = [
    ...(startChart !== undefined ? [[from, startChart] as [string, number]] : []),
    ...s.filter(([d]) => d > from && d <= today),
  ];
  if (!points.length || points.at(-1)![1] !== current) points.push([today, current]);
  return {
    low30,
    low30Date,
    high30,
    atLow30: current <= low30 && high30 > current,
    droppedFrom,
    points,
    from: points[0][0],
  };
}
