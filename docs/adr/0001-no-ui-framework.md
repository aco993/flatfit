# 1. No UI framework: TypeScript, the DOM and three.js

**Status:** accepted · 2026-10

## Context

Most of the screen is a WebGL canvas (three.js) and a path tracer. The rest is a product list, a few dialogs and an SVG floor-plan editor. The candidates were React (with React Three Fiber for the 3D part), Svelte, or no framework.

## Decision

Plain TypeScript modules that render HTML strings into a handful of containers, with event delegation; three.js used directly.

## Why

- The hard parts (planner, fit checks, path-tracing scheduler) are framework-independent; they live in `src/domain` and `src/three` and are unit-tested in Node.
- The 3D scene is rebuilt from data in about 15 ms; a reconciler would add a second model of the scene without making the rebuild cheaper.
- Fewer dependencies keep the bundle and the first render small, which mattered on the Intel UHD laptop the app was tuned on (Lighthouse 32 → 75).
- The UI is small enough that re-rendering a section on change is simple and fast.

## Consequences

- No component library: dialogs, focus management and live regions are written by hand (and tested with axe-core and keyboard-only Playwright tests).
- If the UI grows (accounts, saved projects in the cloud, collaboration), moving the list and editor to a framework is possible without touching `src/domain` or `src/three`.
