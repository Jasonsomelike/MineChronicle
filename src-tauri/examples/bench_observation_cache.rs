//! Same-machine cold/warm queries with five deltas per observed session.
use minechronicle_lib::database::{
    observation_cache::ObservationCache, sessions::ObservationQuery, DbResult, Repository,
};
use rusqlite::Connection;
use std::time::Instant;
fn main() -> DbResult<()> {
    for count in [10, 1000, 10000] {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("benchmark.sqlite3");
        let repo = Repository::open(&path)?;
        let c = Connection::open(&path)?;
        c.execute_batch("INSERT INTO game_roots(id,path,payload) VALUES(1,'D:/QA/root','{}'); INSERT INTO worlds(id,game_root_id,path,status,payload) VALUES(1,1,'D:/QA/root/saves/world','Present','{}'); INSERT INTO players(uuid) VALUES('test-player');")?;
        c.execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,ended_at,status) SELECT 'D:/QA/root','Instance','[]',strftime('%Y-%m-%dT%H:%M:%SZ','2026-01-01',printf('+%d seconds',x*60)),strftime('%Y-%m-%dT%H:%M:%SZ','2026-01-01',printf('+%d seconds',x*60+30)),'closed' FROM n", [count])?;
        c.execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO tracked_deltas(world_id,player_uuid,delta_ticks,observed_at) SELECT 1,'test-player',20,strftime('%Y-%m-%dT%H:%M:%SZ','2026-01-01',printf('+%d seconds',(x/5+1)*60+(x%5)*5)) FROM n",[count*5])?;
        let now = Instant::now();
        let expected = repo.observed_sessions_page(1)?;
        let uncached = now.elapsed();
        let mut cache = ObservationCache::open(&path)?;
        let now = Instant::now();
        let first = cache.query(1, &ObservationQuery::default())?;
        let cold = now.elapsed();
        assert_eq!(first.sessions, expected.sessions);
        let query = ObservationQuery {
            snapshot: first.snapshot,
            ..Default::default()
        };
        let now = Instant::now();
        for _ in 0..30 {
            assert_eq!(cache.query(1, &query)?.sessions, expected.sessions);
        }
        println!("sessions={count} deltas={} uncached_ms={:.3} cache_cold_ms={:.3} cache_warm_mean_ms={:.3}",count*5,uncached.as_secs_f64()*1000.,cold.as_secs_f64()*1000.,now.elapsed().as_secs_f64()*1000./30.);
    }
    Ok(())
}
