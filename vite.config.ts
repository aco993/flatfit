import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/; override with BASE=/ for other hosts.
export default defineConfig({
  base: process.env.BASE ?? './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, sourcemap: true },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as never);
