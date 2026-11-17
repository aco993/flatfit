# 6. Price history read from git at build time

**Status:** accepted · 2026-11

## Context

People buying furniture want to know whether today's price is a real sale or the usual price with a new label. Price-comparison sites show a 30-day history, but they forbid automated reading or answer scripts with a bot challenge (see the comparison-site note in the README), and FlatFit has no server or database to keep a history of its own.

The daily price check ([ADR 2](0002-static-site-git-scraped-prices.md)) already commits every catalogue to git, so the repository holds each product's price day by day.

## Decision

- `scripts/history.mjs` runs before every build (`prebuild`, also `predev`). For each country it walks `git log` of the catalogue (120 days), reads every committed version with `git show`, and keeps one `[date, price]` entry per change.
- It writes `public/history/<cc>.json` (a few kilobytes) and `public/feeds/<cc>.xml`, an RSS feed of the price drops of the last 14 days. Both are build outputs, not committed.
- The app loads the history file after the catalogue, without blocking anything. `domain/history.ts` works out the 30-day low and high and whether today's price is the lowest of them; the product card draws a step chart and marks "lowest in 30 days".
- CI checks out the full history (`fetch-depth: 0`). Without it (a shallow clone, a zip download) the script writes only today's prices and the app shows no history.

## Why

- No new service, no database, no running cost: the history was already there.
- The rules (what counts as the price at the start of the window, a price refreshed in the browser newer than the last commit) are pure functions with unit tests.
- An RSS feed lets anyone follow sales without an account, an e-mail list or a server.

## Consequences

- The history starts when the daily check started (late October 2026) and grows by one commit a day.
- A change in the catalogue that is not a price (a new product, a corrected size) costs nothing: only prices are compared.
- Building needs git and takes a few seconds longer.
