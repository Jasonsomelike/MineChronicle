//! Cooperative shutdown for background worker threads.
//!
//! Both long-lived services (`tracker::watcher::Tracker` and
//! `launcher::sync::PclSync`) own a worker thread and need to stop it from
//! `Drop`. They previously carried byte-identical copies of the same loop, which
//! had a real defect: after a 500 ms wait it did
//!
//! ```ignore
//! if worker.is_finished() { let _ = worker.join(); }
//! ```
//!
//! and then dropped the `JoinHandle` either way. When the worker had *not*
//! finished, the handle was discarded while the thread kept running, so the
//! thread could no longer be joined and everything it owned - its database
//! connection, its `Arc<Mutex<..>>` state - outlived the service that was
//! supposed to shut it down.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How long `Drop` waits for a worker to notice the shutdown flag before giving
/// up and detaching it.
pub(crate) const SHUTDOWN_GRACE: Duration = Duration::from_millis(500);
const SHUTDOWN_POLL: Duration = Duration::from_millis(10);

/// Signals shutdown and waits for the worker, returning whether it stopped in
/// time.
///
/// Takes `&AtomicBool` rather than `&Arc<AtomicBool>` so both call sites fit:
/// `Tracker` stores the flag inline in its shared state, while `PclSync` holds
/// it as its own `Arc`.
///
/// A worker that does not stop within the grace period is deliberately
/// **detached rather than leaked silently**: the handle is dropped on purpose so
/// the process can still exit, and the caller is told so it can say something.
/// Detaching is the only option left at that point - joining would block exit
/// for as long as the worker runs, which for a scan can be a long time - but it
/// should not happen quietly.
pub(crate) fn shutdown_worker(flag: &AtomicBool, worker: Option<JoinHandle<()>>) -> WorkerShutdown {
    flag.store(true, Ordering::Release);
    let Some(worker) = worker else {
        return WorkerShutdown::NotRunning;
    };
    let deadline = Instant::now() + SHUTDOWN_GRACE;
    while !worker.is_finished() && Instant::now() < deadline {
        std::thread::sleep(SHUTDOWN_POLL);
    }
    if worker.is_finished() {
        // The worker finished; its result is irrelevant at shutdown, but the
        // join is what releases the thread's resources deterministically.
        let _ = worker.join();
        WorkerShutdown::Joined
    } else {
        // Dropping the handle detaches the thread. Recorded so callers do not
        // have to guess whether shutdown was clean.
        drop(worker);
        WorkerShutdown::Detached
    }
}

/// Outcome of [`shutdown_worker`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkerShutdown {
    /// There was no worker to stop.
    NotRunning,
    /// The worker stopped and was joined.
    Joined,
    /// The worker was still running after the grace period and was detached.
    Detached,
}

impl WorkerShutdown {
    /// Whether the worker stopped cleanly. `NotRunning` counts as clean.
    pub(crate) fn is_clean(self) -> bool {
        !matches!(self, WorkerShutdown::Detached)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_finished_worker_is_joined() {
        let flag = Arc::new(AtomicBool::new(false));
        let worker = std::thread::spawn(|| {});
        // Let it finish so the join path is the one taken.
        std::thread::sleep(Duration::from_millis(50));
        let outcome = shutdown_worker(&flag, Some(worker));
        assert_eq!(outcome, WorkerShutdown::Joined);
        assert!(outcome.is_clean());
        assert!(flag.load(Ordering::Acquire), "the flag must be set");
    }

    #[test]
    fn a_worker_that_honours_the_flag_stops_within_the_grace_period() {
        let flag = Arc::new(AtomicBool::new(false));
        let worker_flag = Arc::clone(&flag);
        let worker = std::thread::spawn(move || {
            while !worker_flag.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        let outcome = shutdown_worker(&flag, Some(worker));
        assert_eq!(outcome, WorkerShutdown::Joined);
    }

    #[test]
    fn a_worker_that_ignores_the_flag_is_reported_as_detached() {
        let flag = Arc::new(AtomicBool::new(false));
        // Outlives the grace period and never checks the flag.
        let worker = std::thread::spawn(|| std::thread::sleep(Duration::from_secs(2)));
        let started = Instant::now();
        let outcome = shutdown_worker(&flag, Some(worker));
        assert_eq!(
            outcome,
            WorkerShutdown::Detached,
            "an unresponsive worker must be reported, not hidden"
        );
        assert!(!outcome.is_clean());
        // It must not block for the worker's full lifetime.
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "shutdown waited too long: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn no_worker_is_not_a_failure() {
        let flag = Arc::new(AtomicBool::new(false));
        let outcome = shutdown_worker(&flag, None);
        assert_eq!(outcome, WorkerShutdown::NotRunning);
        assert!(outcome.is_clean());
        assert!(flag.load(Ordering::Acquire));
    }
}
