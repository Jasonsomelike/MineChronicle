/* global window */
// Runs inside a Playwright page; all values are synthetic.
export function installObservationFixture(table) {
  // Two instances, because the page groups by instance: with one root the grouping
  // would never be visible and a regression in the group headers, totals or
  // collapse would go unseen.
  //
  // Instance names are stable per root, as they are in the archive: one instance has
  // one name and the sessions under it differ by time. The earlier fixture named
  // every row `QA Session <id>`, which is not a shape the archive can produce and
  // which made the group heading look wrong for the wrong reason.
  //
  // Each row gets a distinct start time (base plus its id in minutes) so the
  // pagination tests can assert which records a page actually reached - the instance
  // name can no longer identify a row now that it is a group heading.
  const rows = Array.from({ length: 51 }, (_, i) => {
    const second = i >= 20 && i < 35;
    const id = 51 - i;
    const at = (minutes) =>
      `2026-09-01T00:${String(minutes).padStart(2, '0')}:00Z`;
    return {
      id,
      game_root: second ? 'D:\\QA\\server' : 'D:\\QA\\root',
      instance_name: second ? '香草纪元：食旅纪行' : 'QA Instance',
      started_at: at(id),
      ended_at: i === 2 ? null : at(id),
      status: i === 2 ? 'interrupted' : 'closed',
      pseudo_seconds: i === 1 || i === 2 ? '0' : '60',
      missing_baseline: i === 1,
    };
  });
  table.tracking_summary.pseudo = [
    {
      game_root: 'D:\\QA\\root',
      instance_name: 'QA Instance',
      seconds: '2940',
      week_seconds: '2940',
      month_seconds: '2940',
      sessions: 49,
      unknown_sessions: 1,
      baseline_sessions: 1,
    },
  ];
  window.__qa = {
    libraryCalls: 0,
    failLibrary: false,
    failObservationPage: 0,
    calls: [],
    rows,
    revision: 0,
  };
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: async (command, args) => {
      const qa = window.__qa;
      qa.calls.push({ command, args });
      if (command === 'load_library') {
        qa.libraryCalls++;
        if (qa.failLibrary) throw Error('QA temporary library failure');
      }
      if (command === 'observed_sessions_page') {
        if (qa.failObservationPage === args.page)
          throw Error('QA temporary observation failure');
        const query = args.query ?? {};
        const boundary = query.boundary ?? qa.rows[0]?.id ?? 0;
        const filtered = qa.rows.filter(
          (s) =>
            s.id <= boundary &&
            (!query.status || query.status === s.status) &&
            (!query.game_root || query.game_root === s.game_root),
        );
        const page = Math.max(
          1,
          Math.min(Math.max(1, Math.ceil(filtered.length / 20)), args.page),
        );
        // Groups mirror what the backend now returns: totals across the whole
        // filtered set, with only this page's rows attached. Built here so the
        // collapsible view is exercised rather than falling back to the single
        // synthetic group the component uses for older archives.
        const pageRows = filtered.slice((page - 1) * 20, page * 20);
        const byRoot = new Map();
        for (const row of filtered) {
          const entry = byRoot.get(row.game_root) ?? {
            game_root: row.game_root,
            name: row.instance_name,
            sessions: [],
            session_count: 0,
            seconds: '0',
            unknown_sessions: 0,
            baseline_sessions: 0,
          };
          entry.session_count += 1;
          if (!row.ended_at) entry.unknown_sessions += 1;
          else if (row.missing_baseline) entry.baseline_sessions += 1;
          else
            entry.seconds = String(
              Number(entry.seconds) + Number(row.pseudo_seconds ?? 0),
            );
          byRoot.set(row.game_root, entry);
        }
        for (const entry of byRoot.values()) {
          entry.sessions = pageRows.filter(
            (r) => r.game_root === entry.game_root,
          );
        }
        return {
          sessions: pageRows,
          groups: [...byRoot.values()],
          total: filtered.length,
          history_total: qa.rows.length,
          boundary,
          new_records: qa.rows.filter((s) => s.id > boundary).length,
          filtered_seconds: filtered
            .reduce((n, s) => n + Number(s.pseudo_seconds), 0)
            .toString(),
          instances: [{ game_root: 'D:\\QA\\root', name: 'QA Instance' }],
          page,
          page_size: 20,
          total_seconds: '2940',
          baseline_sessions: 1,
          unknown_sessions: 1,
          running_sessions: 0,
        };
      }
      if (command === 'tracking_status')
        return { ...table.tracking_status, revision: qa.revision };

      // The manual-end dialog reads its limits before it can be submitted, so
      // the fixture has to answer this or the form stays disabled and the
      // screenshot would miss the real layout.
      if (command === 'observed_session_bounds') {
        const row = qa.rows.find((s) => s.id === args.id);
        if (!row) throw Error('找不到该观测记录');
        if (row.status === 'running')
          throw Error('正在运行的会话不能手动填写结束时间');
        const next = qa.rows
          .filter((s) => s.game_root === row.game_root && s.id !== row.id)
          .map((s) => s.started_at)
          .filter((t) => t > row.started_at)
          .sort()[0];
        return {
          started_at: row.started_at,
          max_ended_at: next ?? null,
          status: row.status,
        };
      }

      // Mirrors the backend's rules, including the CHECK constraint's coupling
      // of ended_at and status, so the fixture cannot accept something the real
      // command would reject.
      //
      // It also mirrors the WIRE NAME: Tauri resolves each parameter with a
      // direct lookup of the camelCase key, so `endedAt` is what arrives. The
      // fixture once read `args.ended_at` and silently accepted the wrong key,
      // which let a broken frontend pass the browser check while the real app
      // failed with "missing required key endedAt". Unknown keys are now
      // rejected rather than ignored.
      if (command === 'set_observed_session_end') {
        const unknown = Object.keys(args).filter(
          (key) => !['id', 'endedAt'].includes(key),
        );
        if (unknown.length)
          throw Error(
            `unexpected argument(s) ${unknown.join(
              ', ',
            )}; the command takes id and endedAt`,
          );
        if (!('endedAt' in args)) throw Error('missing required key endedAt');
        const value = args.endedAt;
        const row = qa.rows.find((s) => s.id === args.id);
        if (!row) throw Error('找不到该观测记录');
        if (row.status === 'running')
          throw Error('正在运行的会话不能手动填写结束时间');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))
          throw Error(`时间格式应为 YYYY-MM-DDTHH:MM:SSZ，收到 ${value}`);
        if (value <= row.started_at) throw Error('结束时间必须晚于开始时间');
        if (Date.parse(value) > Date.now())
          throw Error('结束时间不能晚于当前时间');
        const next = qa.rows
          .filter((s) => s.game_root === row.game_root && s.id !== row.id)
          .map((s) => s.started_at)
          .filter((t) => t > row.started_at)
          .sort()[0];
        if (next && value > next)
          throw Error(`不能晚于下一次会话开始时间 ${next}`);
        row.ended_at = value;
        row.status = 'closed';
        row.ended_source = 'manual';
        row.edited_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        row.pseudo_seconds = String(
          Math.floor((Date.parse(value) - Date.parse(row.started_at)) / 1000),
        );
        return null;
      }

      if (command === 'clear_observed_session_end') {
        const unknown = Object.keys(args).filter((key) => key !== 'id');
        if (unknown.length)
          throw Error(`unexpected argument(s) ${unknown.join(', ')}`);
        const row = qa.rows.find((s) => s.id === args.id);
        if (!row) throw Error('找不到该观测记录');
        if (row.ended_source !== 'manual')
          throw Error('该观测记录的结束时间不是手动填写的');
        row.ended_at = null;
        row.status = 'interrupted';
        row.ended_source = null;
        row.edited_at = null;
        row.pseudo_seconds = '0';
        return null;
      }

      return command in table ? table[command] : null;
    },
  };
}
