# 4. Path tracing in the browser, scheduled so the GPU driver never resets

**Status:** accepted · 2026-10

## Context

A photoreal image sells a layout better than the raster view. Rendering on a server would need GPUs and an upload of the scene; rendering in the browser must work on the integrated GPUs most people have.

## Decision

three-gpu-pathtracer in WebGL2, denoised by Intel Open Image Denoise running on WebGPU (oidn-web), with a scheduler around it:

- each pass is split into tiles, and the next tile is queued only when a `WebGLSync` fence says the previous one finished;
- the tile count adapts to the measured time per tile;
- a lost context or an all-black frame restarts on a fresh canvas with smaller tiles;
- quality (passes, resolution) is chosen from the GPU name and can be overridden; the user can finish early or cancel at any phase.

## Why

Windows resets the graphics driver (TDR) when one submission keeps the GPU busy for about two seconds; without the fence-based scheduler the first version produced a black image on an Intel UHD laptop. With it, 40 passes take about 100 seconds there and come out clean after denoising.

## Consequences

- The first shader compile on a cold Windows (ANGLE) cache can take one to three minutes and stalls page repaint; the app shows a live timer and explains it. This is a browser limit, not something the page can avoid.
- Without WebGPU the denoiser falls back to a bilateral filter, which is noticeably softer.
