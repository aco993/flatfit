# 3. A rule-based furniture planner, with manual moves on top

**Status:** accepted · 2026-10

## Context

The app proposes where each piece goes. Options: an optimiser (simulated annealing or a constraint solver over positions), a learned model, or explicit rules.

## Decision

Explicit rules over free wall spans: walls minus doors (with their swing), windows for tall pieces and radiators; the sofa faces the TV (or the TV socket decides), the bed takes the wall where it and both bedside tables fit, the wardrobe keeps a walkway, the kitchen run and fridge share the niche. The user can then drag any piece; moves are stored as anchor poses and checked with the same footprints.

## Why

- Each decision can be explained to the user in numbers ("kitchen and fridge need 245 cm, the wall has 248 cm"), which an optimiser's score cannot.
- Deterministic: the same flat and products always give the same layout, so share links and tests are stable.
- Fast enough to run on every product change and every pointer move while dragging.

## Consequences

- Unusual rooms (L-shapes, slanted walls) get a sensible but not optimal layout; manual moves cover the gap.
- New rules need tests: `tests/unit/selection.test.ts` checks that the cheapest proposal fits for 5 markets × 3 flats.
