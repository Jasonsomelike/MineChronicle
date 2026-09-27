import React from 'react';
import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import { ThemeProvider } from './app/ThemeContext';
import { applyTheme, loadThemePreference } from './lib/theme';
import { clearLegacyRailPreference } from './lib/rail';
// Bundled, not linked: the app is offline, so a font CDN would fail. The
// package splits subsets by unicode-range, so only latin is ever fetched.
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/tokens.css';
import './warmth.css';
import './styles.css';
import './styles/shell.css';
import './styles/pages.css';
import './motion.css';

// antd's DatePicker reads its month names and first-day-of-week from dayjs's
// own locale; ConfigProvider's `locale` covers only the component strings.
dayjs.locale('zh-cn');

// Applied before the first render on purpose: doing it in a React effect would
// paint the light palette for one frame first, which reads as a flash every
// launch for anyone whose system is dark.
applyTheme(loadThemePreference());
// The rail reads no preference any more - the resting shape is 72px at every width, so
// there is no first-frame width jump to prevent. What must happen before the first
// render is the one-time removal of the key the old three-state preference wrote
// (minechronicle.rail): best-effort and idempotent, so a blocked store cannot break
// boot, and gone rather than left as a key that nothing will ever read again.
clearLegacyRailPreference();

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
