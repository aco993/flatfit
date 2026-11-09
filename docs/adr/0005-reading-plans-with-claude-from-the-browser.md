# 5. Reading a floor-plan picture with an AI, from the browser, with the user's own key

**Status:** accepted · 2026-11

## Context

Most people do not have their flat as numbers. They have an architect's drawing, a photo of the sales brochure, or a sketch with dimensions written on it. Tracing rooms over a picture already worked (load, set the scale from a wall of known length, draw), but drawing ten rooms and their doors by hand is the step where people give up.

FlatFit is a static site: no server, no accounts, nothing to keep secret.

## Decision

Two layers, the second optional:

1. **Faster tracing, offline, for any picture.** In the editor, drag over the picture to draw a room (edges snap to nearby walls, then to a 5 cm grid) and click on a wall to put a door or window there.
2. **"Read the rooms from the picture (AI)", two providers, free first.**
   - **Google Gemini** (`gemini-3.8-flash`, default): free with a Google AI Studio key up to a daily quota. Plain `fetch` to `generateContent` (the key in the `x-goog-api-key` header, never the URL), JSON output against the same schema (`responseJsonSchema`). On the free tier Google may use what is sent to improve its products; the panel says so before anything is sent. A `429 RESOURCE_EXHAUSTED` is shown as "the free quota is used up: it renews daily, until then a paid key is needed".
   - **Claude** (`claude-opus-5-5`): paid, a few cents per plan, the most accurate with dimension lines. No free quota; a key without credit is told so.

   For Claude, the picture (at most 1568 px on the long edge) goes from the browser straight to the Claude API with the user's own API key, using the official TypeScript SDK (`dangerouslyAllowBrowser: true`). The answer is structured output against a JSON schema (`output_config.format`): rooms as rectangles in metres, doors and windows on their walls, open-plan pairs, the outline's pixel box, and a short note. Server-side `fallbacks: "default"` retries a declined request on the model Anthropic recommends for it.

The answer is treated as a suggestion. `src/domain/planread.ts` clamps every number, drops unknown types and doors on no wall, lines up walls that almost meet, and lays the picture under the rooms using the pixel box, so the user corrects the result over the same picture before saving.

## Why

- **The owner pays nothing.** Every call uses the visitor's own key, so a free option had to exist: Gemini's free tier. Groq's free tier (used in another project) has no model that reads images, and local models are too slow and weak on dimension lines.
- **The user's key, in the user's browser.** A proxy would need a server, a billing account and abuse protection, and the plan would pass through a third party. Here the key is kept in `sessionStorage`, or `localStorage` only when the user ticks *remember*; it is never in the repository, the build or share links.
- **Structured output, then our own checks.** The schema guarantees shape; it cannot guarantee that a 3.82 m wall is read as 3.82. Geometry rules the model does not have to follow exactly (shared edges, no overlaps) are enforced in code and covered by unit tests.
- **Loaded only on use.** The SDK is a separate 80 kB (gzip) chunk fetched on the first click; the page others see did not get heavier.

## Consequences

- With Gemini a reading is free until the daily quota runs out; with Claude it costs a few cents. Either takes up to a minute.
- Both APIs answer browser requests (checked from the live site: Gemini returns a readable `400 API_KEY_INVALID` for a fake key, Claude a `401`).
- Tests never call the API: unit tests feed canned answers, and end-to-end tests intercept `api.anthropic.com` and `generativelanguage.googleapis.com` and check the requests (model, picture, schema, where the key goes, not remembered unless asked) and the used-up-quota message.
- Plans used while building this are not in the repository; the test fixture is a made-up two-room drawing.
- Without a key, layer 1 still works.
