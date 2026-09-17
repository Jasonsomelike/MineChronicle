import { createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import ErrorBoundary from './ErrorBoundary';

const PageActive = createContext(true);
export const usePageActive = () => useContext(PageActive);

/** Keep visited pages in memory for this process; never persist page operations. */
export default function SessionPage({
  active,
  label,
  children,
}: {
  active: boolean;
  /** Page name used by the error fallback. */
  label?: string;
  children: ReactNode;
}) {
  const parentActive = useContext(PageActive);
  active = active && parentActive;
  const visited = useRef(false);
  if (active) visited.current = true;
  return (
    <div hidden={!active} className="session-page">
      {visited.current ? (
        <PageActive.Provider value={active}>
          {/* Per-page isolation: a crash here must not blank the whole shell,
              and revisiting the page retries instead of keeping the fallback. */}
          <ErrorBoundary label={label} resetKey={active}>
            {children}
          </ErrorBoundary>
        </PageActive.Provider>
      ) : null}
    </div>
  );
}
