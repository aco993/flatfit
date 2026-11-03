# FlatFit: case study

**What:** a browser app that furnishes any flat in 3D with real products from local stores, checks that everything fits, totals the shopping list per country, and renders a photoreal image on the GPU.
**Live:** https://aco993.github.io/flatfit/ · **Code:** this repository · **Stack:** TypeScript, three.js, three-gpu-pathtracer, Intel Open Image Denoise (WebGPU), Vite, Vitest, Playwright, GitHub Actions.

## The problem

I was furnishing a small flat to rent out. Store websites show one product at a time; planners show generic furniture without prices; spreadsheets do not tell you whether the 225 cm sofa fits the wall next to the balcony door. I wanted one place that answers three questions together: *what does a cheap but nice setup look like with products I can actually buy, what does it cost, and does it fit?*

## Approach

**Data first, 3D second.** A flat is a list of axis-aligned rooms, openings (door, window, balcony, entrance) on room sides, open-plan pairs, and wall items (radiators, TV socket). Everything else is derived:

- *Walls* come from room edges: shared edges merge into one wall, edges between open-plan rooms disappear, terrace-only edges become parapets.
- *Free wall spans* come from walls minus doors (with their swing), windows (only for tall pieces) and radiators.
- *The layout* is rule-based: the sofa takes the longest wall and faces the TV (or the TV socket decides), the bed goes where the bed and both bedside tables fit, the wardrobe goes on another wall and keeps a walkway to the bed, the fridge and kitchen share one run.
- *Fit checks* compare the chosen product's real size with the span it got: “kitchen and fridge need 245 cm, the wall has 248 cm”. Overruns up to 10 cm are “measure first”, more is “does not fit”.

The domain code (`src/domain`) imports neither the DOM nor three.js, so all of it runs in plain Node tests.

**Moving things by hand** is the same model again: a move stores where one piece's anchor ends up; pieces that belong to it (TV on its bench, chairs at the table, bedside tables at the bed) follow rigidly. While dragging, the app snaps to a 5 cm grid, turns wall pieces' backs to the nearest wall, and checks the footprint against other furniture, walls, door swings and radiators on every pointer move. The check is cheap because it reuses the planner's footprints instead of the 3D meshes.

## Hard parts

### 1. A photoreal render that does not crash a laptop

The first version showed a black image on an Intel UHD laptop. The path tracer queued tile after tile; one submission kept the GPU busy for more than two seconds and Windows reset the driver (TDR). The fix was a small scheduler:

- split every sample into tiles and queue the next tile only when a `WebGLSync` fence says the previous one finished, so work never piles up;
- adapt the tile count to the measured time per tile;
- detect a lost context or an all-black frame and start over on a fresh canvas with smaller tiles;
- choose fast / balanced / high quality from the GPU name, build the BVH in a worker, and let the user finish early or cancel at any phase.

Few samples look noisy, so the image is denoised by Intel OIDN running as a neural network on WebGPU, guided by albedo and normal buffers that the raster pipeline renders from the same camera. Without WebGPU a bilateral filter is used. On the laptop that used to crash, 40 passes now take about 100 seconds and come out clean.

### 2. Prices that stay honest

Germany and Austria are rebuilt every week from IKEA's public search endpoint. The Serbian catalogue was assembled by hand from several stores, so a second script re-checks each product on its own page (search API, schema.org offers, shop data) and stamps the date the price was confirmed. Two stores answer automated requests with a Cloudflare challenge; the script skips them rather than working around it, and the app labels those prices “checked by hand” with their date. The first run changed 70 of 114 prices because a big promotion had just ended, which the tests caught as a contrast failure on the newly visible “sale ended” labels before any user did.

### 3. Five markets, and prices that keep up with sales

Croatia came almost for free: the IKEA script only needed Croatian search phrases and measurement names ("Širina", "Dubina"), so it now takes a language table instead of German strings. Bosnia and Herzegovina had no IKEA online shop, so its catalogue comes from JYSK BiH (each category page publishes a schema.org item list, each product page an offer with the sale's end date) and Technoshop for appliances; kitchen units are estimates from IKEA Croatia converted to KM at the fixed rate and labelled as estimates.

Sales were the other problem: a weekly snapshot misses most of them. Every price is now re-checked daily by a GitHub Action that commits the result to `main` after the unit tests pass, and the app has a *Refresh prices* button. IKEA's search endpoint answers cross-origin requests, so the button checks every IKEA price live from the visitor's browser, including when a sale ends; the other stores come from the newest committed catalogue. Writing the Bosnian reader exposed a bug in the existing Serbian one: for products sold in several colours it read the offer of the last colour on the page instead of the product's own, so a curtain rod showed 600 instead of 750 dinars. Offers are now matched by URL.

### 4. Testing like users, not like functions

Unit tests (Vitest) cover the geometry, planner, quantities, promotions, moves, snapping, collisions and catalogue schema, plus parity of the three translations. End-to-end tests (Playwright) each play one person:

| Persona | What they do |
|---|---|
| Ana, phone, Serbian | cheapest look, product card, store link, no sideways scroll |
| Jonas, Berlin | switches market, all links go to IKEA Germany, shares a link that restores the same total |
| Mira, keyboard and screen reader | skip link, shortcuts, help, language cycling, axe-core scan with no serious violations |
| Luka, landlord | draws a studio, adds a room by keyboard, saves, exports, deletes |
| Nina, only a picture of her plan | loads it, sets the scale from a known wall, draws a room to it |
| Sara, rearranging | drags the sofa with a real mouse, sees the collision, turns it, undoes and redoes |
| Petra, old laptop | starts a render and cancels it; the page stays usable |

A second spec runs ten URL and device combinations (every market and language, a phone, dark mode, links with moved furniture or a whole floor plan, a broken link) in Chromium, Firefox and WebKit. It found that a link with moved furniture but no flat id dropped the moves.

CI runs typecheck, unit tests, build, and the personas on every push, and deploys to GitHub Pages only when all of them pass.

### 5. Performance

Lighthouse on a laptop with Intel UHD graphics at first measured performance 32 (desktop) and 15 (mobile), with a layout shift of 0.89. Profiling showed that JavaScript was not the problem (under about 1 s at startup). The real problems were:

- the 3D panel jumping when the view tabs filled in;
- the scene being built three times at startup;
- shaders being compiled synchronously, which on a cold Windows (ANGLE/D3D11) shader cache blocks for seconds.

Fixes so far:
- reserved space and static labels: the layout shift went from 0.89 to under 0.07;
- one build at startup and geometry reused between builds: a warm rebuild takes about 15 ms;
- `compileAsync` with `KHR_parallel_shader_compile` before the first frame;
- floor materials cached, which stops a texture leak on every drag;
- accessibility, best practices and SEO all at 100.

The last freeze, 3 seconds on a cold cache, came from three's PMREM baking the environment light. Its GGX prefilter shader compiled synchronously. I pre-compiled it with `compileAsync`, but the profile still showed two variants: my warm-up mesh had an empty geometry, which flips the `hasPositionAttribute` flag in the program cache key. With PMREM's own plane geometry the variants match, and the longest task dropped from 3.2 s to 0.33 s.

Final Lighthouse numbers on the same laptop:
- performance 75 on desktop and 66 on mobile;
- total blocking time 370 ms on desktop;
- layout shift 0.09.

A second round, on the throttled mobile profile, took total blocking time from 9.2 s to 1.6 s and desktop to 94–96. The profile pointed at work that a small scene does not need: three.js tested every mesh's bounding sphere against the camera on every frame (the flat is always on screen, so culling is off), the shadow map was redrawn on every camera frame although only a rebuild or a drag changes it, the room labels read the canvas size from the DOM on every frame and so forced a layout after each list update, and 5 MB of decorative models (plants, a vase, the terrace set) were downloaded and parsed before anyone looked. They now load on the first interaction or when the page is idle, with textures at 512 px. The last layout shift came from the scrollbar appearing once the list rendered; reserving its gutter fixed it.

### 6. A budget as a knapsack

"Furnish this for 9,000 KM" is a multiple-choice knapsack: every slot picks one product (optional slots may stay empty), a pick costs what it adds to the shopping list including its dependents (a bed frame with its slatted base), and its value is the slot's typical price × log(cost), so the money goes where it shows and each extra mark on a slot is worth a little less. Dynamic programming over the budget in 600 steps solves it in milliseconds. Pieces chosen one by one can still clash (a wide fridge next to a long kitchen), so the result is run through the fit checks and any piece that breaks the plan falls back to the cheapest one that fits; if quantities push the real total over the budget, it solves again a little lower.

## What I would do next

- L-shaped rooms as one room instead of two connected rectangles.
- Assembly costs per store, and delivery prices read from the stores that only show them in the basket.
- Real user sessions: the feedback form in the app goes to GitHub issues.

## How it was built

Built with AI pair programming (Claude Code): I set the goals, tested on my own flat and hardware, and reviewed the changes; the commits are co-authored accordingly.
