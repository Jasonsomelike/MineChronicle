import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { themeFor } from '../lib/antdTokens';
import type { ResolvedTheme } from '../lib/theme';

/**
 * The resolved palette, shared by antd's ConfigProvider and the native side.
 *
 * `main.tsx` runs `applyTheme` before the first render (the FOUC defence), so the
 * initial state is read off `<html data-theme>` rather than re-derived: the DOM
 * attribute is the source, this context only mirrors it into the library. When
 * the preference changes, `ThemeSetting.choose()` writes the attribute (native
 * CSS re-themes instantly) and calls `setResolved` in the same event - both
 * writes land in one React commit, so there is no frame where the hand-written
 * surfaces and the antd surfaces disagree about which theme is showing.
 */
type ThemeContextValue = {
  resolved: ResolvedTheme;
  setResolved: (next: ResolvedTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  resolved: 'light',
  setResolved: () => {},
});

/** The resolved palette and its single write path. */
export function useResolvedTheme() {
  return useContext(ThemeContext);
}

function readDocumentTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [resolved, setResolvedState] =
    useState<ResolvedTheme>(readDocumentTheme);
  const setResolved = useCallback(
    (next: ResolvedTheme) => setResolvedState(next),
    [],
  );
  const theme = useMemo(() => themeFor(resolved), [resolved]);
  const value = useMemo(
    () => ({ resolved, setResolved }),
    [resolved, setResolved],
  );
  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={theme}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
