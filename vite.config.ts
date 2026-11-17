import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/; override with BASE=/ for other hosts.
export default defineConfig({
  base: process.env.BASE ?? './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    sourcemap: true,
    rolldownOptions: {
      output: {
        // three.js core in a file of its own: the site is redeployed every day with new prices, and the app's code
        // changes then but three does not, so returning visitors keep it from their cache
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ }] },
      },
    },
  },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as never);
