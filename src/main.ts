import './styles.css';
import { App } from './ui/app';

const app = new App();
(window as unknown as { flatfit: App }).flatfit = app;
app.start();

// offline use (public/sw.js): only in the built site, so the dev server always serves fresh modules
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
