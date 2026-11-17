# Architecture decision records

Short notes on the decisions that shape FlatFit: the context, what was decided, and what it costs.

| # | Decision |
|---|---|
| [1](0001-no-ui-framework.md) | No UI framework: TypeScript, the DOM and three.js |
| [2](0002-static-site-git-scraped-prices.md) | A static site with prices scraped into git, and live IKEA checks in the browser |
| [3](0003-rule-based-planner.md) | A rule-based furniture planner, with manual moves on top |
| [4](0004-path-tracing-in-the-browser.md) | Path tracing in the browser, scheduled so the GPU driver never resets |
| [5](0005-reading-plans-with-claude-from-the-browser.md) | Reading a floor-plan picture with an AI (free Gemini or paid Claude), from the browser, with the user's own key |
| [6](0006-price-history-from-git.md) | Price history read from the git history of the catalogues at build time, and an RSS feed of price drops |
| [7](0007-offline-with-a-small-service-worker.md) | Offline with a small hand-written service worker |
