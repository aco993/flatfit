# 2. A static site with prices scraped into git

**Status:** accepted · 2026-11

## Context

Prices change daily and sales start and end. A backend that proxies store APIs would always be fresh, but it costs money, needs monitoring and would hit the stores on every visit.

## Decision

- The site is static (GitHub Pages). Catalogues are JSON files in the repository.
- A scheduled GitHub Action re-checks every price on the store's own page each morning (`scripts/prices.mjs`), runs the unit tests on the new data and commits the result to `main` ("git scraping"), then redeploys. On Mondays it also rebuilds the IKEA catalogues to bring in new products.
- The **Refresh prices** button in the app checks IKEA live from the visitor's browser (IKEA's public search endpoint allows cross-origin requests) and takes every other store from the newest catalogue in the repository. The result is kept in `localStorage`, per country.
- Stores that answer with a bot challenge are skipped, never worked around. Their prices keep the date of the last manual check and the app shows that date.

## Why

- Zero running cost and nothing to keep alive; the git history is a free price history.
- The price check is honest about its sources: live (IKEA), daily check (other stores), hand-checked (stores behind Cloudflare), estimate (no local online seller).
- Unit tests guard the data before it reaches visitors (schema, sizes, sale dates, links).

## Consequences

- A store without IKEA's CORS headers is at most one day old in the app, not live.
- Product ids must stay stable between daily runs; only the weekly rebuild may add or drop products.
- `main` gets a data commit most days; local clones need `git pull` before work.
