# 5. Reading a floor-plan picture with Claude, from the browser, with the user's own key

**Status:** accepted · 2026-11

## Context

Most people do not have their flat as numbers. They have an architect's drawing, a photo of the sales brochure, or a sketch with dimensions written on it. Tracing rooms over a picture already worked (load, set the scale from a wall of known length, draw), but drawing ten rooms and their doors by hand is the step where people give up.

FlatFit is a static site: no server, no accounts, nothing to keep secret.

## Decision

Two layers, the second optional:

1. **Faster tracing, offline, for any picture.** In the editor, drag over the picture to draw a room (edges snap to nearby walls, then to a 5 cm grid) and click on a wall to put a door or window there.
2. **"Read the rooms from the picture (Claude)".** The picture (at most 1568 px on the long edge) goes from the browser straight to the Claude API with the user's own API key, using the official TypeScript SDK (`dangerouslyAllowBrowser: true`). The answer is structured output against a JSON schema (`output_config.format`): rooms as rectangles in metres, doors and windows on their walls, open-plan pairs, the outline's pixel box, and a short note. Server-side `fallbacks: "default"` retries a declined request on the model Anthropic recommends for it.

The answer is treated as a suggestion. `src/domain/planread.ts` clamps every number, drops unknown types and doors on no wall, lines up walls that almost meet, and lays the picture under the rooms using the pixel box, so the user corrects the result over the same picture before saving.

## Why

- **The user's key, in the user's browser.** A proxy would need a server, a billing account and abuse protection, and the plan would pass through a third party. Here the key is kept in `sessionStorage`, or `localStorage` only when the user ticks *remember*; it is never in the repository, the build or share links.
- **Structured output, then our own checks.** The schema guarantees shape; it cannot guarantee that a 3.82 m wall is read as 3.82. Geometry rules the model does not have to follow exactly (shared edges, no overlaps) are enforced in code and covered by unit tests.
- **Loaded only on use.** The SDK is a separate 80 kB (gzip) chunk fetched on the first click; the page others see did not get heavier.

## Consequences

- Each reading costs the user a few cents and takes up to a minute.
- Tests never call the API: unit tests feed canned answers, and an end-to-end test intercepts `api.anthropic.com` and checks the request (model, fallback, picture, the key in the `Authorization` header, not remembered unless asked).
- Plans used while building this are not in the repository; the test fixture is a made-up two-room drawing.
- Without a key, layer 1 still works.
