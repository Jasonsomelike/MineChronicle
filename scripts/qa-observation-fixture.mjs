/* global window */
// Runs inside a Playwright page; all values are synthetic.
export function installObservationFixture(table) {
  const rows = Array.from({ length: 51 }, (_, i) => ({
    id: 51 - i,
    game_root: 'D:\\QA\\root',
    instance_name: `QA Session ${51 - i}`,
    started_at: '2026-09-01T00:00:00Z',
    ended_at: i === 2 ? null : '2026-09-01T00:01:00Z',
    status: i === 2 ? 'interrupted' : 'closed',
    pseudo_seconds: i === 1 || i === 2 ? '0' : '60',
    missing_baseline: i === 1,
  }));
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
        return {
          sessions: filtered.slice((page - 1) * 20, page * 20),
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
      if (command === 'set_observed_session_end') {
        const row = qa.rows.find((s) => s.id === args.id);
        if (!row) throw Error('找不到该观测记录');
        if (row.status === 'running')
          throw Error('正在运行的会话不能手动填写结束时间');
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(args.ended_at))
          throw Error(
            `时间格式应为 YYYY-MM-DDTHH:MM:SSZ，收到 ${args.ended_at}`,
          );
        if (args.ended_at <= row.started_at)
          throw Error('结束时间必须晚于开始时间');
        if (Date.parse(args.ended_at) > Date.now())
          throw Error('结束时间不能晚于当前时间');
        const next = qa.rows
          .filter((s) => s.game_root === row.game_root && s.id !== row.id)
          .map((s) => s.started_at)
          .filter((t) => t > row.started_at)
          .sort()[0];
        if (next && args.ended_at > next)
          throw Error(`不能晚于下一次会话开始时间 ${next}`);
        row.ended_at = args.ended_at;
        row.status = 'closed';
        row.ended_source = 'manual';
        row.edited_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        row.pseudo_seconds = String(
          Math.floor(
            (Date.parse(args.ended_at) - Date.parse(row.started_at)) / 1000,
          ),
        );
        return null;
      }

      if (command === 'clear_observed_session_end') {
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
