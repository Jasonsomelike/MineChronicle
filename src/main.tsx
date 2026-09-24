import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, loadThemePreference } from './lib/theme';
import { applyRail, loadRailPreference } from './lib/rail';
// Bundled, not linked: the app is offline, so a font CDN would fail. The
// package splits subsets by unicode-range, so only latin is ever fetched.
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/tokens.css';
import './warmth.css';
import './styles.css';
import './styles/shell.css';
import './styles/pages.css';
import './motion.css';

// Applied before the first render on purpose: doing it in a React effect would
// paint the light palette for one frame first, which reads as a flash every
// launch for anyone whose system is dark.
applyTheme(loadThemePreference());
// Same reason, same place. A collapsed rail resolved in an effect would paint
// the 192px labelled column first and then snap to 72px on every launch, which
// moves the whole page's width for one frame.
applyRail(loadRailPreference());

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
