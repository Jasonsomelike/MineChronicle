use minechronicle_lib::{database::Repository, launcher::running::ActiveInstance};

#[test]
fn observation_intervals_preserve_boundaries_and_distinguish_interruption(
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.sqlite3");
    let mut repo = Repository::open(&path)?;
    let mut a = ActiveInstance {
        game_root: temp.path().join("a"),
        name: "ATM 10".into(),
        pids: vec![21],
    };
    let b = ActiveInstance {
        game_root: temp.path().join("b"),
        name: "Second".into(),
        pids: vec![22],
    };
    repo.observe_instances(&[a.clone(), b.clone()])?;
    let first = repo.observed_sessions()?;
    assert_eq!(first.len(), 2);
    let start = first
        .iter()
        .find(|s| s.instance_name == "ATM 10")
        .ok_or("first interval")?
        .started_at
        .clone();
    assert_eq!(start.len(), 20, "UTC timestamps have second precision");
    repo.observe_instances(&[a.clone(), b.clone()])?;
    a.pids.push(23);
    repo.observe_instances(&[a.clone(), b.clone()])?;
    assert_eq!(
        repo.observed_sessions()?.len(),
        2,
        "polls or overlapping PIDs do not duplicate sessions"
    );
    repo.observe_instances(std::slice::from_ref(&a))?;
    let rows = repo.observed_sessions()?;
    let closed = rows
        .iter()
        .find(|s| s.instance_name == "Second")
        .ok_or("second interval")?;
    assert_eq!(closed.status, "closed");
    assert!(closed
        .ended_at
        .as_ref()
        .is_some_and(|end| end >= &closed.started_at));
    // An immediate relaunch of the same instance is a separate interval.
    a.pids = vec![24];
    repo.observe_instances(std::slice::from_ref(&a))?;
    let rows = repo.observed_sessions()?;
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].status, "running");
    assert_eq!(rows[2].started_at, start);
    assert_eq!(rows[2].status, "closed");
    repo.interrupt_observed_sessions()?;
    drop(repo);
    let repo = Repository::open(&path)?;
    let rows = repo.observed_sessions()?;
    assert_eq!(rows[0].status, "interrupted");
    assert_eq!(rows.len(), 3, "all history survives reopening");
    repo.interrupt_observed_sessions()?;
    assert_eq!(
        repo.observed_sessions()?.len(),
        3,
        "startup does not delete history"
    );
    assert!(
        rows[0].ended_at.is_none(),
        "observer shutdown is not game exit"
    );
    assert!(rows[1].ended_at.is_some());
    Ok(())
}
