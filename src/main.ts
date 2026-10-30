import './styles.css';
import { App } from './ui/app';

const app = new App();
(window as unknown as { flatfit: App }).flatfit = app;
app.start();
