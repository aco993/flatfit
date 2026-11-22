# FlatFit: case study

**What:** a browser app that furnishes any flat in 3D with real products from local stores, checks that everything fits, totals the shopping list per country, and renders a photoreal image on the GPU.
**Live:** https://aco993.github.io/flatfit/ · **Code:** this repository · **Stack:** TypeScript, three.js, three-gpu-pathtracer, Intel Open Image Denoise (WebGPU), Gemini and Claude APIs with the visitor's own key, Vite, Vitest, Playwright, GitHub Actions.

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
| Ivo, laptop without a graphics card | reads the list first, starts the 3D view when he asks for it, and next time it starts by itself |
| Vesna, knows what she wants, not what to buy | describes it in a sentence, then asks for another coffee table and sees that nothing else moved |
| Dario and Lea, a picture of a plan and an API key | let Claude or the free Gemini tier read the rooms; Lea is told clearly when the free quota is used up |

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

A third round looked at phones and machines without a GPU, which the desktop numbers hid. On a browser that draws WebGL on the CPU (SwiftShader in virtual machines and in the headless Chrome that CI uses), compiling a dozen shaders froze the page for 4–8 seconds, and the shopping list, which is what most visitors come for, waited behind it. three.js, the viewer and the furniture builder now load as one module after the list is on screen. Such browsers are recognised from a throwaway canvas without loading three.js, and there the 3D view waits behind a *Show the 3D view* button; once someone asks for it, it starts by itself on later visits. The profile then showed a 7-second task while the page sat idle: the environment light was being baked for a scene nobody was looking at. It now waits until the 3D view starts, and is skipped on software rendering, where a hemisphere light does the job. On an emulated Pixel 7 with 4× CPU throttling and software WebGL, old and new build side by side: the list is readable after about 2 s instead of 5 s, total blocking time fell from 4–11 s to 1–2.5 s, and 233 KB of JavaScript loads instead of 919 KB. Lighthouse in CI went from 0.42–0.47 to 0.67–0.77.

### 6. A budget as a knapsack

"Furnish this for 9,000 KM" is a multiple-choice knapsack: every slot picks one product (optional slots may stay empty), a pick costs what it adds to the shopping list including its dependents (a bed frame with its slatted base), and its value is the slot's typical price × log(cost), so the money goes where it shows and each extra mark on a slot is worth a little less. Dynamic programming over the budget in 600 steps solves it in milliseconds. Pieces chosen one by one can still clash (a wide fridge next to a long kitchen), so the result is run through the fit checks and any piece that breaks the plan falls back to the cheapest one that fits; if quantities push the real total over the budget, it solves again a little lower.

### 7. Features from the shopping trip, not from a wish list

The second round of features came from furnishing the flat for real. The questions in the store were: *is this a real sale?* (the git history of the daily price check now answers it: a 30-day low on the product card, an RSS feed of drops), *what have I bought and what is left to pay?* (a shopping list by store with ticks), *the sofa at the market is not in any catalogue* (add any product with its size and price, and it goes through the same fit checks), *the store has no signal* (a service worker), and for a landlord *does furnishing pay?* (furniture and wear against the extra rent). Paint and laminate quantities come from the wall and floor areas the plan already knows. Assembly came later, store by store, and follows the same rule as delivery: where a store publishes a price (IKEA in Serbia, Croatia, Germany and Austria; connecting a washer or an oven at Neckermann) the list shows "from" that amount, checked on a known date; where a store gives prices only on request, the list says so and links to its page instead of guessing.

### 8. Refactoring without changing a pixel

The floor-plan editor had grown into one function of 787 lines and the furniture builder into one of 464. The editor is now a state object and modules by concern (view, pointer, typing and buttons, the plan picture, AI reading), with the geometry of editing (snapping, the wall nearest a click, resizing) moved into pure, unit-tested functions. The builder makes one context and calls one module per part of the flat. To prove the 3D scene did not change, a fingerprint of every mesh (slot, geometry, world matrix rounded to a millimetre, colour) was compared before and after for three looks and both wall heights: identical.

### 9. An AI stylist that cannot invent a product

"Calm and warm, for renting to couples, under 2,500 €, guests can sleep on the sofa" is easy for a language model to understand and risky to let it answer: it would happily name a sofa that no store in Bosnia sells. So the model never chooses products. It answers with settings only (a look, a budget, the optional pieces wanted or not, a sofa bed or not), constrained by a JSON schema, and every field is checked again against the known values. FlatFit's own planner and the budget solver from section 6 then pick real products that fit the flat, and add back each wish while the budget allows it.

It became a conversation once I used it: "cheaper, but keep the bed" or "another TV" should change one thing, not the whole flat. The schema got three more fields (the pieces to keep, the only pieces to change, and which way to go: cheaper, better or just different), and the follow-up prompt carries the earlier wish and the current list. Kept pieces are pinned before the knapsack runs, so the budget is spent around them, and the dialog lists exactly what changed with the new total.

The key is the visitor's own: a free Google AI Studio key for Gemini, or a Claude key, in which case the stylist asks Claude Haiku, the small model, for the settings with low effort, at well under a cent per wish. The key stays in the browser, goes to the provider in a header and never into a URL or a share link, and the tests check exactly that. An answer that is refused or does not match the schema changes nothing and says why. The same pattern reads a picture of a floor plan: the model returns rooms, doors and windows, the app lines them up and lays them over the picture, and the person corrects what it got wrong. The end-to-end tests stub both providers and check the requests they would receive.

### 10. Checking what the 3D view shows

Refactoring the builder (section 8) was proved with a one-off fingerprint. That check is now permanent: a unit test builds the scene in Node without a GPU from made-up products with fixed sizes, so the daily price changes cannot move it, and snapshots every piece's mesh count and bounding box to the centimetre. A change to how anything is built or placed shows up as a readable diff ("bed: 6 meshes" becomes "17 meshes").

Geometry does not catch a wrong material or a black canvas, so a second test looks at the picture. Pixel screenshots of WebGL differ between my laptop's GPU and CI's software renderer, so the test reduces three camera views to a 32 × 20 grid of average colours and compares it with a stored grid: it fails when more than 2 % of the cells change clearly. The same baseline passes on both machines. Removing the sofa changed 5.9 % of the cells when the test was written, and the test removes it on every run to make sure the limit still catches that.

### 11. Furniture that looks like the product

The 3D pieces always had the product's width, depth, height and colour, but every wardrobe was a white box with a door every 48 cm and every bed the same frame. There are free CC0 models for chairs and small tables, but none for a modern sofa, bed or wardrobe, and a period piece would misrepresent what the store sells. The product names turned out to carry the rest: Serbian stores write "3V2F" for three doors and two drawers and "4K1F1O" for four doors, a drawer and a mirror; JYSK writes "2 vrata 3 ladice", IKEA "3-türig" or "s kliznim vratima". A small parser, unit-tested against every wardrobe and bed in the five catalogues, turns that into door columns, drawers, a row of short doors where six would not fit side by side, a mirror door or sliding panels. Upholstered beds get a padded headboard in channels, beds with storage get drawers down to the floor, and the others stand on legs. The sofa got slim legs, padded arms and a chaise cushion on corner sofas. Where a name says nothing, the old rule by width still applies.

## What I would do next

- Measure on a real mid-range phone, not only an emulated one, and run the stylist against the live Gemini free tier on a schedule.
- Sloped ceilings and walls that are not at right angles; the plan model is axis-aligned today.
- Delivery prices read from the stores that only show them in the basket.
- Real user sessions: the feedback form in the app goes to GitHub issues.
- Paint and laminate as real products with prices; "when to buy" advice once the price history covers a few sales cycles.

## How it was built

Built with AI pair programming (Claude Code): I set the goals, tested on my own flat and hardware, and reviewed the changes; the commits are co-authored accordingly.
