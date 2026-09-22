import ErrorBoundary from './components/ErrorBoundary';
import AppShell from './app/AppShell';
import ArchivePages from './app/ArchivePages';
import { useAppState } from './app/useAppState';

export default function App() {
  const state = useAppState();
  return (
    <AppShell state={state}>
      <ErrorBoundary>
        <ArchivePages state={state} />
      </ErrorBoundary>
    </AppShell>
  );
}
