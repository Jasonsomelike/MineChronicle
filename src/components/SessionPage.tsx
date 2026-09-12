import { createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';

const PageActive = createContext(true);
export const usePageActive = () => useContext(PageActive);

/** Keep visited pages in memory for this process; never persist page operations. */
export default function SessionPage({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const parentActive = useContext(PageActive);
  active = active && parentActive;
  const visited = useRef(false);
  if (active) visited.current = true;
  return (
    <div hidden={!active} className="session-page">
      {visited.current ? (
        <PageActive.Provider value={active}>{children}</PageActive.Provider>
      ) : null}
    </div>
  );
}
