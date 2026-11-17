import type { App } from '../../src/ui/app';

// main.ts puts the app on window for tests and debugging
declare global {
  interface Window {
    flatfit: App;
  }
}
