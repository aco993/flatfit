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

### 3. Testing like users, not like functions

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

CI runs typecheck, unit tests, build, and the personas on every push, and deploys to GitHub Pages only when all of them pass.

### 4. Performance

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

Still open: a CPU profile pins the remaining 3 s stall on a cold cache to the GGX prefilter shader that three's PMREM compiles while baking the environment light. The next step is to compile that variant in advance or bake the environment map ahead of time.

## What I would do next

- L-shaped rooms as one room instead of two connected rectangles.
- A budget goal (“furnish this for 3,000 €”) solved as a small knapsack over the catalogue.
- Delivery and assembly costs per store, which change the real total by more than most product swaps.
- Real user sessions: the feedback form in the app goes to GitHub issues.

## How it was built

Built with AI pair programming (Claude Code): I set the goals, tested on my own flat and hardware, and reviewed the changes; the commits are co-authored accordingly.
