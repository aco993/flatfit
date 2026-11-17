# 7. Offline with a small hand-written service worker

**Status:** accepted · 2026-11

## Context

The shopping list is used in furniture stores, where the phone often has no signal. Everything FlatFit needs is static: the page, the build's hashed files, the catalogues (bundled as JS chunks), models, the denoiser's weights and the price history.

## Decision

- `public/sw.js`, about 60 lines, no library. Pages are network first and fall back to the last copy, so a new deploy is picked up as soon as there is a network. Files under `assets/` are cache first (their names change with their content). Everything else from the site is served from the cache at once and refreshed in the background.
- Requests to other sites (IKEA's live price check, an AI service reading a plan) are never touched.
- It is registered only in the production build, so the dev server always serves fresh modules.
- A web app manifest makes the site installable.
- End-to-end tests block service workers by default: a worker takes requests out of reach of Playwright's `page.route()`, which several tests use to fake IKEA or an AI service. `offline.spec.ts` allows it, visits once, goes offline and checks that the app, the catalogue and the shopping list still open.

## Why

- A library such as Workbox would add a build step and a dependency for three caching rules.
- Network first for pages avoids the classic service-worker trap of visitors stuck on an old version.

## Consequences

- The first visit is not cached until the worker takes over; the second load fills the cache.
- The cache holds a few megabytes (models, textures); old caches are deleted when the cache name changes.
