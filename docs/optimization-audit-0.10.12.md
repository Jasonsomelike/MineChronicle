# 优化清单 0.10.12

本文是一次只读审计的结果，覆盖性能、稳定性、可维护性和工程质量四类。审计基于当前工作树（`feature/runtime-stat-icons`，含 `507f23a`）和本机真实档案，未修改任何代码，未读取或修改游戏文件。

每一项固定给出：严重度、位置、现状、证据、改法。工作量用 S（半天内）、M（1–2 天）、L（3 天以上或需设计取舍）标注。

**进度**：第 1 批已完成，见下方"已完成"一节；其余各项仍待处理。审计期间还提交了两个改动（Java 实体模型 UV 画布修正、统计页全量重查），不在清单内，其中引入的新风险记为 B11。

---

## 已完成（第 1 批）

提交 `优化：第 1 批` 修掉了下列 5 项，均通过验证。

| 项  | 内容                                                                                                                                                            | 验证方式                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D3  | `runtime_resources.rs:777-785` 改用 `std::f32::consts::FRAC_PI_4` / `FRAC_PI_8`                                                                                 | 8 条腿的 yaw 序列化结果与改前**逐字节相同**（f32 常量与原字面量位相同）；`clippy --all-targets -D warnings` 通过          |
| D3b | **审计遗漏的第二层**：修掉 approx_constant 后 clippy 才推进到 `lib test`，暴露 65 处 `unwrap_used`/`expect_used`（全在测试模块）                                | 在 `lib.rs` 加 `#![cfg_attr(test, allow(...))]`；并用临时探针确认生产代码的 deny 仍然生效                                 |
| B3  | `watcher.rs` 事件回调与取用处改用 `PoisonError::into_inner()` 恢复，不再静默丢弃文件事件                                                                        | 编译 + 全量测试；被守护的只是路径集合，无 panic 可破坏的不变量                                                            |
| B1  | `runtime_info`、`acknowledge_view`、`self_player_identity`、`set_self_player_identity`、`startup_status`、`set_startup_enabled` 改为 `async` + `spawn_blocking` | 两个集成测试改用既有 `tauri::async_runtime::block_on` 范式后通过                                                          |
| B2  | 新增 `ErrorBoundary`，根部包裹 + `SessionPage` 每页隔离（带 `resetKey` 重试）                                                                                   | **真实 Edge 无头浏览器实测**：注入渲染异常后 `.app-header` 仍在（外壳存活）、显示"实例观测"页面级回退、离开再回来恢复正常 |
| B10 | `ScanPanel.changeScope` 调用 `savePlayers`，玩家选择真正落盘                                                                                                    | **真实浏览器实测**：选中后写入 localStorage，刷新后仍在；并把修复 stash 掉复跑，确认该脚本会 FAIL（`stored=null`）        |

`phase_status` 保持同步：它是纯计算，无 IO。

B10 的回归脚本 `scripts/qa-player-persistence.mjs` 与 B2 的 `scripts/qa-error-boundary.mjs` 保留在仓库中，都要求先自行运行 `npm run dev`（脚本不自己拉起服务器，避免留下孤儿 vite 进程）。

---

## 现状核实（审计时快照）

下表是审计当时的状态；D3/B1/B2/B3/B10 已在第 1 批修复，其余仍然成立。

| 检查         | 命令                                        | 结果                                              |
| ------------ | ------------------------------------------- | ------------------------------------------------- |
| TypeScript   | `npm run typecheck`                         | 通过                                              |
| 前端测试     | `npm test`                                  | 通过，16 文件 / 77 用例                           |
| 前端构建     | `npm run build`                             | 通过，45.9s，含 >500 kB chunk 警告                |
| Rust 测试    | `cargo test`                                | 通过，131 用例                                    |
| Rust 格式    | `cargo fmt --check`                         | 通过                                              |
| **ESLint**   | `npm run lint`                              | **失败，10 处错误**（仍待修，见 D1）              |
| **Prettier** | `npm run format:check`                      | **失败，35 文件 + 1 处语法错误**（仍待修，见 D2） |
| **Clippy**   | `cargo clippy --all-targets -- -D warnings` | **已修复**，见"已完成"                            |
| CI           | —                                           | 无 `.github`，无流水线                            |

三项红灯的失败位置：

- ESLint 10 处，全部在 `scripts/`：`debug-ferrouslime.mjs:9`、`fix-ghost-qa.mjs:13`、`playwright-entity-render-check.mjs:30,109`、`visual-qa-box.mjs:40`、`visual-qa-spider-color.mjs:25`、`visual-qa-spider.mjs:27`、`visual-qa-two-box.mjs:2,4,26`。
- Prettier 35 文件：`scripts/` 24 个、`src/` 4 个、`docs/` 3 个，加 `eslint.config.js`、`package.json`、`README.md`、`src-tauri/tauri.conf.json`。其中 `scripts/visual-qa-spider.mjs` 是**语法级**失败，见 D2。
- Clippy 9 处全部是 `runtime_resources.rs:777-785` 的 `approx_constant`（`0.7853982`、`0.3926991`）。**这些行在 `HEAD` 即存在**，不属于当时待提交的改动。

真实档案规模（`D:\MineChronicleData\minechronicle.sqlite3`，6.77 MB，只读查询）：

| 指标                            | 数值                                        |
| ------------------------------- | ------------------------------------------- |
| 世界 / 玩家 / world_players     | 97 / 53 / 203                               |
| stat_snapshots                  | 412（initial_import 203 + observation 209） |
| scan_runs / anomalies           | 242 / 242                                   |
| tracked_deltas / stat_rollbacks | 6 / 0                                       |
| `current_stats` 总字符          | 1,953,615                                   |
| 快照 stats 总字符               | 4,132,524                                   |
| 快照单行均值                    | 约 10 KB                                    |
| 去重后 category\|key            | **18,882**                                  |
| `journal_mode`                  | `delete`                                    |
| 图标资产                        | 10,710 个 / 73.7 MB，**0 个未被引用**       |

---

## A. 性能：统计页与数据库热路径

### A1（高）`statistics()` 每次请求全量重建再分页

- **位置**：`src-tauri/src/database/activity.rs:315-554`，关键行 `:380-446`（聚合）、`:536-541`（分页）。
- **现状**：每次调用都把范围内所有玩家的 `current_stats` JSON 全量解析，在 Rust 侧构造 `BTreeMap<(category,key), …>`，然后才 `.skip(offset).take(100)`。分类计数、排序、搜索都在这个全量集合上做。
- **证据**：本机档案实测，`statistics(current)` 解析 63,386 条 / 18,882 个不同键，纯 Python 解析耗时 **23.5 ms**（Rust 更快，但量级同阶）；IPC 返回的 100 行页面典型 **134 KB**，最重的 100 行达 **872 KB**（因为每行都带 `source_packs` 与 `resources[].packs`，而 `stat-resources.json` 里单键最多挂 37 个 pack 名）。分页只改变传输量，不改变每请求的全量解析成本。
- **改法**：把聚合下沉到 SQL。`current_stats` 已是 JSON，可用 `json_each` + `GROUP BY category, key` 直接在 SQLite 内求和，只对当前页取明细；或（更彻底）在 `import()` 时物化一张 `stat_values(world_id, player_uuid, category, key, value, …)` 表并建索引，让统计页变成纯索引扫描。两者都需要重新设计 `samples` / `resources` 的装载时机，属于**需要设计取舍**的改动。
- **风险/工作量**：L。会触碰 `activity_contract.rs`、`statistics_categories_contract.rs`、`statistics_categories_contract.rs` 的语义断言，需先补契约测试。

### A2（高）`Repository::load()` 是 N+1

- **位置**：`src-tauri/src/database/mod.rs:245-320`。`prepare` 出现在循环**内部**：`:255` 每个 root 准备一次 worlds 查询，`:268` 每个 world 准备一次 players 查询；`:268` 的 SQL 还含每行一个相关子查询 `(SELECT play_ticks FROM stat_snapshots … kind='initial_import')`。`:290-296` 另有一次对**全部** initial_import 快照的行级求和。
- **现状**：`load()` 被 `commands/runtime.rs:17`、`commands/library.rs:18`、`commands/scan.rs:146`、`database/health.rs:109` 以及 `tracker/watcher.rs:394`（**每轮 watcher 循环**）调用。
- **证据**：本机档案 `load()` 的原始读取约 **2.3 ms**（203 + 97 + 64 + 63 + 203 行），但这只是把行读出来；`prepare` 次数随 root/world 数量线性增长（当前 64 root + 97 world = 161 次 prepare），且 `:290` 的求和随快照数无界增长。
- **改法**：把三个 `prepare` 提到循环外；用一条 `LEFT JOIN` 取回 (root, world, player, initial_ticks) 再在 Rust 侧分组；`:290` 改成 `SELECT sum(play_ticks)` 由 SQLite 求和。
- **风险/工作量**：S。纯内部重构，`database_contract.rs` 可作回归网。

### A3（高）31 处 `Repository::open` 各自重跑迁移事务，且未启用 WAL

- **位置**：`src-tauri/src/database/mod.rs:52-84`（迁移块）、`:54-55`（唯一的两条 PRAGMA）。
- **现状**：`Repository::open` 每次都开新连接、`busy_timeout(5s)`、`PRAGMA foreign_keys=ON`，然后在一个事务里按 `user_version` 决定执行哪几个 `*.sql`，最后 commit。全仓 **31 处**调用点，其中 `commands/scan.rs:161` 与 `:177` 在同一次 `resolve_pcl_context` 里开了**两次**；`commands/health.rs:25-27` 与 `:42-44` 是"开 → 改 → 再开 → 读汇总"。
- **证据**：实测 `journal_mode = delete`（全仓 grep `journal_mode` 只命中 `storage.rs:31` 的一句注释）。`delete` 模式下每次写事务都要 fsync 并独占文件锁，而 `busy_timeout` 只有 5 秒。
- **改法**：在 `lib.rs` 的 `setup` 里开一次连接放进 `DatabaseState`（`Mutex<Repository>`），各命令改为借用；退一步至少执行一次 `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`。注意 watcher 线程与前台扫描并发写同一库，WAL 能显著减少"database is locked"重试。
- **风险/工作量**：M。改 `DatabaseState` 形状会波及全部命令签名，但每个命令改动都很机械。

### A4（高）图标解析全程持有一把全局锁，且会整体清空缓存

- **位置**：`src-tauri/src/minecraft/runtime_resources.rs:1747-1750`（全局 `CACHE` 锁）、`:1774-1783`（TTL 与 `cache.clear()`）、`:368-396`（`read()` 持 `archives` 锁解压）、`:286` 与 `:313`（`sources(root)` 被调用两次）。
- **现状**：`resolve_stat_icons` 在 `spawn_blocking` 里锁住全局 `CACHE`，然后在其下完成索引构建、逐条 `resolve()`、base64 编码、写磁盘缓存。`:1780` 的 `if cache.len() >= 4 { cache.clear(); }` 会丢弃**所有** root 的索引，包括其它 root 已预热的 `archives` 与 `model_class_files`。`read()` 在持有 `archives` 互斥锁的情况下做 zip 解压，且 `:375` 的 `archives.clear()` 会在批量中途关闭所有已打开的 `File` 句柄。
- **证据**：`Statistics.tsx:183` 每次打开统计页都发起一次 `cacheOnly` 调用，`:137` 的"检查本页游戏图标"发起全量调用；两者都会命中上述路径。本机图标缓存目录已有 596 个文件 / 5.74 MB，说明缓存确实在被反复读写。
- **改法**：把"索引构建"与"逐条解析"分开加锁（例如索引放在 `RwLock` 或 `Arc` 快照里，锁只覆盖查找不覆盖 IO）；`read()` 改为先取出 `Arc<File>` 或复制所需 entry 字节再解压；去掉 `cache.clear()`，改为按 root 淘汰；`indexed()` 内复用一次 `sources(root)` 的结果。
- **风险/工作量**：M。并发行为改动，需要人工验证图标仍能正确补齐。

### A5（中）扫描发现阶段是 O(n²)，且反复重解析 `PCL/Setup.ini`

- **位置**：`src-tauri/src/scanner/discovery.rs:102` 与 `:110`（`roots.contains` 线性查找）、`:90`（每个目录调用一次 `scan_linked_container`）；`src-tauri/src/launcher/pcl.rs:225`（`settings()` 解析）。
- **现状**：`roots` 是 `Vec<PathBuf>`，在最多 10,000 个条目的循环里用 `.contains()` 判重；`scan_linked_container` 对每个弹出的目录都调用一次，而它会重新读取并解析同一个 `PCL/Setup.ini`。
- **证据**：`discovery.rs:54` 的 `budget = 10_000`、`:122` 的 256 root 上限；`pcl.rs:52-76` 的 `settings()` 每次调用都 `bounded()` 读文件 + 逐行切分。
- **改法**：`roots` 改 `HashSet<PathBuf>`（保留插入顺序可另存一个 `Vec`）；把解析好的 Setup.ini 结果按 launcher 路径 memo 一次，传给本轮所有容器。
- **风险/工作量**：S。

### A6（中）`timeline` 每请求跑两遍 CTE，日期过滤让索引失效

- **位置**：`src-tauri/src/database/activity.rs:276-281`（count 与 page 各跑一次 `EVENTS`）、`:197-209`（CTE 定义与 `FILTER`）。
- **现状**：`EVENTS` 内含两个 `EXISTS`/`NOT EXISTS` 相关子查询，`total` 与当前页各执行一次完整 CTE。`FILTER` 里 `date(observed_at,'localtime')>=?4` 对列施加函数，无法走 `snapshots_by_time` 索引（`005_activity.sql:2`）。
- **证据**：`005_activity.sql` 建了 `snapshots_by_time ON stat_snapshots(observed_at,id)`；本机 412 行快照尚小，但 `stat_snapshots` 是增长最快的表（见 A8）。
- **改法**：日期条件改写为 `observed_at >= ?` 的半开区间（把 `localtime` 换算放在参数侧）；`total` 改用 `count(*) OVER ()` 窗口函数与页面查询合并成一次。
- **风险/工作量**：M。需覆盖本地时区边界，`activity_contract.rs` 有日期用例。

### A7（中）20.6 MB JSON 编入二进制，逐行克隆进 IPC

- **位置**：`src-tauri/src/minecraft/translations.rs:26-32` 与 `:175-181`（`include_str!`）、`:34-48`（`stat_resources`）、`database/activity.rs:58-70`（`StatisticRow.resources`）。
- **现状**：`stat-resources.json` 18,105,863 字节 + `stat-translations.json` 2,417,350 字节经 `include_str!` 进二进制，首次使用时解析；`stat_resources()` 对每行 `format!("{category}|{key}")` 查表并 `.cloned()` 整个 `Vec<StatResource>`，随后整份进 IPC。
- **证据**：实测 `stat-resources.json` 有 **18,882** 个键、**41,110** 条 pack 记录、单键最多 37 个 pack、平均 2.0 个候选资源；A1 的 872 KB 最重页面直接由此产生。
- **改法**：只把当前页需要的键查出来（现在也是这么做的，但每行都带全量 packs）；`packs` 改为索引引用而非内联字符串数组；`source_packs` 与 `resources[].packs` 目前**重复**传输同一批 pack 名，可去重。
- **风险/工作量**：M。需同步改前端 `activity.ts` 的类型与 `Statistics.tsx` 的渲染。

### A8（中）`stat_snapshots` 无界增长，每次观察存完整 stats blob

- **位置**：`src-tauri/src/tracker/ledger.rs:24-51`（`observe`）、`database/001_initial.sql:9-11`（表定义）。
- **现状**：只要 `normalized_hash` 与游标不同就插入一行完整 `stats`（约 10 KB），即使时长没变。目前 412 行 / 4.13 MB，占总库 6.77 MB 的 61%。
- **证据**：实测 observation 快照 209 行 / 2,179,233 字符；其中 203 行**没有**产生任何 `tracked_deltas`（因为时长未变，仅其它统计项变化）。快照单行均值 10,427 字符。按当前频率线性外推：2,000 行约 22 MB，20,000 行约 220 MB。
- **改法**：为 observation 行做保留策略（例如同 (world,player) 只保留最近 N 条 + 全部有 delta 的行）；或把 `stats` 存为压缩 blob（zstd/flate2，仓库已依赖 `flate2`）；或在时长未变时只存差分。**属于需要设计取舍**的改动，因为时间线（A6）会读这些快照。
- **风险/工作量**：L。

### A9（中）watcher 每轮序列化整个 summary 计算指纹，`watch_paths` 重复调用

- **位置**：`src-tauri/src/tracker/watcher.rs:496-499`（指纹）、`:412` 与 `:516`（两次 `watch_paths`）、`:136-166`（`safe_dir` 反复 stat）。
- **现状**：`blake3::hash(&serde_json::to_vec(&(&summary, stats))?)` 把包含所有玩家标准化统计的整个 summary 序列化一遍，只为了判断"内容是否变化"；`roots.clone()` 再分配一次。`watch_paths` 每轮调用两次，内部对同一批路径重复 `symlink_metadata`。
- **证据**：`watcher.rs:266-267` 的 `last_scan`/`last_full` 与 `RECONCILE=300s` 决定该块每轮或每 5 分钟执行；`watch_paths` 对每个 world 做 `root.path`、`saves`、`world.path`、`stats`、`players`、`players/stats` 最多 6 次 `safe_dir`。
- **改法**：指纹改为对每个 (world, player) 的 `normalized_hash` 已存值求和/哈希（`tracking_cursors` 已有该字段），避免重新序列化统计体；`watch_paths` 结果在 `library` 未变时缓存复用。
- **风险/工作量**：M。

### A10（中）统计文件读取的重试与缓存策略

- **位置**：`src-tauri/src/scanner/stable_stats.rs:39-60`（重试）、`:14-35`（缓存）。
- **现状**：`read_stats` 最多 4 次尝试，每次之间 `std::thread::sleep(100ms)`，即最坏 **300 ms/文件**，且发生在扫描热循环内（`scanner/world.rs:116`）。缓存以整文件 BLAKE3 为键，命中仍需完整读取并哈希整个文件。淘汰时 `values.values().map(|v| v.0).sum::<usize>()` 每次插入重算一遍。
- **证据**：`stable_stats.rs:41` 的 `for attempt in 0..4`、`:43` 的 sleep；`:28-29` 的 512 条 / 32 MiB 阈值。
- **改法**：先按 (path, len, mtime) 做廉价预筛，仅在内容疑似未变时跳过重读；重试改为指数退避并设总预算；用维护在结构里的累计字节数替代每次重算。
- **风险/工作量**：M。注意 `scan_optimization_contract.rs:75` 明确断言"不信任 mtime"，改动不能破坏该保证。

### A11（中）Tailwind 实际未使用，却占三分之二的构建时间

- **位置**：`vite.config.ts:3,6`（插件）、`src/styles.css:1`（`@import 'tailwindcss'`）、`package.json:33,47`。
- **现状**：全仓仅 `Dashboard.tsx` 一个文件含疑似工具类；`styles.css` 2,342 行与 `warmth.css` 482 行都是手写 CSS。构建产出 51.07 kB CSS。
- **证据**：`npm run build` 的 `[PLUGIN_TIMINGS]` 显示 `@tailwindcss/vite:generate:build` 占 **30.1s / 45.9s（66%）**；构建产物中 `--tw-*` 变量 87 处但工具类几乎为空（`.flex{`、`.grid{` 各 0–1 处），说明 Tailwind 在扫描全仓却只产出 preflight 与 theme 变量。
- **改法**：确认不使用后移除 `@tailwindcss/vite`、`tailwindcss`、`styles.css` 的 `@import`，构建时间预计下降约 30 秒；若想保留，需真正改用工具类。属于**需要你确认方向**的取舍。
- **风险/工作量**：S（移除）／L（迁移到工具类）。

### A12（低）产物与依赖体积

- **位置**：`dist/`、`package.json`。
- **现状**：`dist` 71.7 MB，其中 10,710 个图标 PNG 全量复制（73.7 MB，实测 0 个未被引用，所以不是垃圾，但每次构建都整份拷贝）；`RankingChart` chunk 471.96 kB、`stat-icon-renderer` 566.34 kB、主 `index` 373.72 kB。
- **证据**：`vite build` 输出与 `dist` 实测；`:474-480` 的 chunk 警告。
- **改法**：图标改为按需从磁盘缓存加载（A4 已有运行时缓存机制），或对 PNG 做无损再压缩；`stat-icon-renderer` 已是动态 `import()`，可进一步确认它只在需要时下载。
- **风险/工作量**：M。

### A13（低）前端逐像素扫描整图

- **位置**：`src/lib/runtimeResources.ts:110-163`（`cropOpaquePortrait`）、`:125-134`（双重循环）。
- **现状**：对整张皮肤 PNG 逐像素找不透明包围盒，512×512 即 262,144 次迭代，且在主线程。
- **证据**：`getImageData` + 双层 `for` 直接读 `data[...+3] > 8`。
- **改法**：降采样后再找包围盒（例如每 4 像素采样），或移到 OffscreenCanvas/Worker。
- **风险/工作量**：S。

### A14（低）三套轮询与常驻挂载

- **位置**：`src/components/ScanPanel.tsx:154`（5s）、`:211`（3s）、`:291`（60s）；`src/components/SessionPage.tsx:17-24`；`src/components/InstanceObservation.tsx:39`（3s）。
- **现状**：`SessionPage` 一旦被访问就永久挂载（`visited` 只置真不置假），只靠 `hidden` 隐藏；其中 `Statistics`/`Timeline`/`Dashboard` 的 effect 仍会因 `pageActive` 之外的依赖变化而运行。四个独立定时器各自轮询。
- **证据**：`SessionPage.tsx:18` 的 `if (active) visited.current = true`，无反向重置；`ScanPanel.tsx` 三个 `setInterval` 分别在 154/211/291 行。
- **改法**：合并状态轮询为单一 tick 再分发；`SessionPage` 在长时间未访问后卸载（或至少让子页 effect 统一早退）。
- **风险/工作量**：M。

---

## B. 稳定性：主线程阻塞与错误兜底

### B1（高）若干 Tauri 命令跑在主线程

- **位置**：`src-tauri/src/commands/runtime.rs:16`（`runtime_info`）、`commands/preferences.rs:5` 与 `:12`（`self_player_identity` / `set_self_player_identity`）、`commands/mod.rs:28`（`phase_status`）、`commands/startup.rs:88` 与 `:112`。
- **现状**：这些命令**没有** `async`，按 Tauri 语义在**主线程**执行；每个都新开 SQLite 连接并（`runtime_info`）跑一次完整 `load()`。同目录的 `library.rs`、`tracking.rs`、`activity.rs`、`health.rs` 都已经用了 `async` + `spawn_blocking`。
- **证据**：`runtime_info` 在 `ScanPanel.tsx:329` 的启动 `Promise.all` 中被调用；`self_player_identity` 在 `selfPlayer.ts:18` 启动时调用。两者都会走 `Repository::open` 的迁移事务（A3）。
- **改法**：与兄弟命令一致改为 `async fn` + `tauri::async_runtime::spawn_blocking`。
- **风险/工作量**：S。纯机械改动，签名不变。

### B2（高）前端没有 ErrorBoundary —— 已修复（第 1 批）

- **位置**：`src/main.tsx:9-13`、`src/App.tsx`。
- **现状**：全仓 grep `ErrorBoundary` / `componentDidCatch` / `getDerivedStateFromError` 结果 **0 处**。任何渲染期异常都会卸载整棵树，用户看到空白页且没有任何提示。
- **证据**：`main.tsx` 直接 `createRoot(...).render(<App/>)`，无包裹。
- **改法**：加一个 ErrorBoundary 包住 `<App/>`（以及各 `SessionPage` 内部，避免单页崩溃拖垮整个壳），显示错误摘要与"重新加载"按钮。可顺带接 `window.onerror` / `unhandledrejection`（当前 0 处全局处理）。
- **风险/工作量**：S。

### B3（高）watcher 在互斥锁中毒时静默丢弃文件事件

- **位置**：`src-tauri/src/tracker/watcher.rs:236-246`（事件回调）、`:398-401`（取用）。
- **现状**：回调里 `if let Ok(mut paths) = event_paths.lock()` —— 若锁中毒则**整个事件被丢弃**，但下一行 `changed.store(true, …)` 仍执行；`:400` 的 `changed_paths.lock().map(…).unwrap_or_default()` 同样在中毒时静默返回空集合。
- **证据**：两处都只在 `Ok` 分支处理，无 else、无日志、无 `set_error`。结果是一条**永久静默的数据丢失路径**：`dirty` 被置位触发扫描，但事件路径为空，扫描范围退化为全量或空。
- **改法**：中毒时至少 `set_error` 并置 `overflow`，让 5 分钟补偿检查兜底；更好的是改用 `parking_lot::Mutex`（无中毒）或 `poisoned.into_inner()` 继续使用。
- **风险/工作量**：S。

### B4（中）两个后台服务的 `Drop` 会泄漏线程

- **位置**：`src-tauri/src/tracker/watcher.rs:57-70`、`src-tauri/src/launcher/sync.rs:46-59`。
- **现状**：`Drop` 忙等最多 500 ms，然后 `if worker.is_finished() { let _ = worker.join(); }`。若线程仍在运行，`JoinHandle` 被 `take()` 后直接丢弃——**线程继续跑且无法再 join**，其持有的 `Arc<Mutex<…>>` 与数据库连接一并泄漏。
- **证据**：两处实现逐字相同；`PclSync` 的 worker 在锁内可能正处于 `discover_and_scan_linked`（`sync.rs:199`）。
- **改法**：`Drop` 里无条件 `join()`（接受退出变慢），或改用带超时的协作式关闭 + `detach` 并在文档中写明；至少不要丢掉句柄。
- **风险/工作量**：S。

### B5（中）健康检查在首个超限分组处终止全部分析

- **位置**：`src-tauri/src/database/health.rs:74-93`，关键是 `:81-84`。
- **现状**：`'groups:` 循环里，一旦 `pairs.len() >= MAX_PAIRS`（2000）就 `break 'groups` —— 不是跳过当前分组，而是**放弃所有剩余分组**。`limited` 只置位一个布尔，UI 仅提示"部分候选尚未列出"。
- **证据**：`health.rs:7` 的 `MAX_PAIRS = 2000`、`:83` 的 `break 'groups`；`DataHealth.tsx:260-264` 的提示文案。
- **改法**：改为 `continue 'groups`（只跳过放不下的分组）并累计被跳过的分组数，在 `analysis_limited` 之外回报具体数量。
- **风险/工作量**：S。

### B6（中）`review_health` 双跑全量健康汇总

- **位置**：`src-tauri/src/database/health.rs:277-291`、`src-tauri/src/commands/health.rs:24-31` 与 `:41-48`。
- **现状**：`review_health` 先 `self.health_summary()?` 校验 key 存在，改完再由命令层再调一次 `health_summary()` 返回新状态。`health_summary` 内部又调 `self.load()`（A2 的 N+1）并重扫候选。
- **证据**：`health.rs:278` 的校验调用 + `commands/health.rs:27` 的返回调用 = 每次点击 2 次全量；`decide_clone` 同理（`:44`）。
- **改法**：校验改为直接查 `health_reviews` 与当前 issues 的最小集合（或信任前端传入的 key 并容错），避免重复构建完整汇总。
- **风险/工作量**：S。

### B7（中）单实例检测在主线程最多睡 3 秒，失败静默

- **位置**：`src-tauri/src/desktop.rs:68-105`，关键是 `:95-103`。
- **现状**：第二个实例发现互斥量已存在后，循环 30 次 × 100 ms 用 `FindWindowW` 找窗口，找不到就 `Ok(None)`；调用方 `lib.rs:49-52` 直接 `return Ok(())`，进程以退出码 0 静默结束，用户双击图标毫无反应。
- **证据**：`:95` 的 `for _ in 0..30`、`:102` 的 sleep；`lib.rs:49-52` 无任何提示分支。
- **改法**：缩短重试（例如 10 × 100 ms），失败时用 `MessageBoxW` 或写一条 `last-startup.json` 记录说明原因，而不是静默退出。
- **风险/工作量**：S。

### B8（中）托盘退出在 UI 线程开数据库连接

- **位置**：`src-tauri/src/desktop.rs:25-33`。
- **现状**：托盘"彻底退出"的菜单回调里 `Repository::open(&database.path)` 新开连接并跑一次 `UPDATE observed_sessions`。菜单回调在 UI 线程，且 `Repository::open` 会重跑迁移事务（A3）。
- **证据**：`:28` 的 `Repository::open`；对比 `watcher.rs:561-565` 已有关闭路径。
- **改法**：让 `Tracker` 暴露一个 `interrupt_now()`（复用其连接或至少复用 `DatabaseState` 的常驻连接），托盘只发信号。
- **风险/工作量**：S（依赖 A3 的常驻连接）。

### B9（中）`setup` 在窗口显示前做阻塞 IO

- **位置**：`src-tauri/src/lib.rs:54-71`。
- **现状**：主线程顺序执行 `create_dir_all`、`Repository::open`（完整迁移事务）、写 `last-startup.json`，全部在窗口显示之前。`:64` 的 `std::env::current_exe()?` 与 `to_vec_pretty` 每次启动都跑。
- **证据**：`lib.rs:56-65`；`Repository::open` 见 A3。
- **改法**：把数据库打开与诊断写盘移到 `setup` 之后的异步任务；`last-startup.json` 改为可选诊断（或仅在版本变化时写）。
- **风险/工作量**：M。需保证首个命令到达时数据库已就绪（可与 A3 的常驻连接一起做）。

### B10（高）玩家选择偏好实际从未被保存 —— 已修复（第 1 批）

- **位置**：`src/lib/players.ts:20-49`。
- **现状**：`initialPlayers()`（`:20`）与 `initialPlayersNone()`（`:35`）从 `localStorage` 读取 `minechronicle.players` / `minechronicle.players-none`；但全仓 grep 显示 **`savePlayers`（`:42`）没有任何调用者**。因此写入路径不存在。
- **证据**：`ScanPanel.tsx:88-102` 用 `initialPlayers()` 初始化三个 scope，`changeScope`/`onScope` 只更新 React state；`players.test.ts:22` 断言 `initialPlayers()` 返回 `[]`（恰好掩盖了问题）。README 与 `docs/phase-10.md:8` 都声明"保存至本机界面偏好"。
- **改法**：在 `changeScope` / `onScope` 处调用 `savePlayers(uuids, players_none)`（注意 `savePlayers` 第二参数默认 `false`，需显式传），或在 `CombinationPicker.onChange` 统一持久化。修好后需补一条"写入后能读回"的测试。
- **风险/工作量**：S。**这是一处与文档不符的功能缺陷**，建议优先修。

### B11（中）统计页全量重查放大了 Java 字节码提取预算

- **位置**：`src/components/Statistics.tsx:134-137` 与 `:169-176`（本次提交引入）、`src-tauri/src/minecraft/runtime_resources.rs:1722`（上限）与 `:1117-1126`（预算）。
- **现状**：提交 `507f23a` 让统计页对所有非 air 行做运行时检查，而 `resolve_stat_icons` 的请求上限恰好是 `requests.len() > 100`，`page_size` 也是 100——正好卡在边界。同时 `MAX_JAVA_ATTEMPTS` 由 12 提到 **256**，且每批重置。
- **证据**：`runtime_resources.rs:1722-1728` 的 `> 100` 与 `Statistics.tsx` 的 `page_size: 100`（`activity.rs:550`）；`java_model_resolution` 每次可收集 ≤1.5 MB class 字节（`:1142`）并 base64 进 IPC。
- **改法**：给"完整检查"加分批（例如每批 25 行、串行 await）并显示进度；或把 `MAX_JAVA_ATTEMPTS` 改为按批传入的参数而非固定 256。同时把请求上限与 `page_size` 解耦，避免任何页大小调整都整批失败。
- **风险/工作量**：M。

### B12（低）非 UTF-8 路径让整个导入失败

- **位置**：`src-tauri/src/database/mod.rs:333-335`（`path_key`）、调用点 `:108`、`:130`、`:182`、`:199` 等。
- **现状**：`path_key` 对无法转 UTF-8 的路径返回 `Err`，`import()` 用 `?` 直接传播——单个世界的路径含非法 UTF-8 会让**整次扫描**回滚（`scan_commands_contract.rs` 的 `failed_import_rolls_back_the_entire_scan` 正是这个行为）。
- **证据**：`:334` 的 `path.to_str().ok_or("路径包含无法保存的字符")`。
- **改法**：改为跳过该条并记一条 `ScanIssue`，让其余世界正常导入。
- **风险/工作量**：S。

---

## C. 可维护性

### C1（高）`runtime_resources.rs` 2205 行且不内聚

- **位置**：`src-tauri/src/minecraft/runtime_resources.rs` 全文。
- **现状**：单文件混装至少七类职责：图标磁盘缓存与 PNG 头解析（`:105-192`）、全局索引与归档互斥锁（`:36-47`、`:312-396`）、资源包来源发现含 `options.txt` 解析（`:204-282`）、Minecraft 模型父子链解析（`:407-471`）、**约 450 行硬编码 per-mod 实体别名**（`:579-652`）、Java `.class` 常量池解析（`:908-956`）、Bedrock 几何与 vanilla 模板 JSON 字面量（`:733-857`）、两个 `#[tauri::command]`（`:1651`、`:1713`），外加 430 行测试（`:1830-2263`）。
- **证据**：文件行数与上述区段；`cache_key`、`indexed`、`java_model_resolution` 等函数之间没有共享抽象。
- **改法**：按职责拆分为 `runtime_resources/{cache.rs, index.rs, entity/{aliases.rs, bedrock.rs, java_class.rs, scoring.rs}, commands.rs}`；把别名表外置为 JSON（与 `stat-resources.json` 同级的 `resources/` 目录），与既有"数据不入代码"的做法一致。
- **风险/工作量**：L。纯搬迁，但文件大、测试多，建议单独一次提交且不改逻辑。

### C2（中）三份逐字重复的玩家名称赋值循环

- **位置**：`src-tauri/src/commands/scan.rs:121-137`、`src-tauri/src/tracker/watcher.rs:461-471`、`src-tauri/src/launcher/sync.rs:220-231`。
- **现状**：三处都在做 `local_names(&root.path, &scopes, &mut issues)`，然后遍历 world→player、解析 UUID、命中就写 `preferred_name` + `name_source = "usercache"`。
- **证据**：三段的控制流与赋值完全一致，只有 `scopes` 的构造方式不同。
- **改法**：抽成 `scanner::apply_local_names(&mut summary_roots, &scopes, &mut issues)`，三处调用。
- **风险/工作量**：S。

### C3（中）watch/unwatch 块重复且含整集克隆

- **位置**：`src-tauri/src/tracker/watcher.rs:412-428` 与 `:516-537`。
- **现状**：两段逐字相同的"按 desired 差集 unwatch、再差集 watch、统计失败数"逻辑；都写成 `for path in desired.difference(&registered.clone())`，在循环条件里克隆整个集合（因为循环体要 `registered.insert`）。
- **证据**：两段的行数与结构；`:418` 与 `:527` 的 `.clone()`。
- **改法**：抽成 `fn reconcile_watches(watcher, desired, &mut registered) -> usize`（返回失败数），内部先收集差集到 `Vec` 再插入，去掉克隆。
- **风险/工作量**：S。

### C4（中）整套领域模型只被一个测试使用

- **位置**：`src-tauri/src/domain/models.rs` 全文（`LauncherInstallation`、`Instance`、`GameRoot`、`World`、`Player`、`AccountType` 与 4 个 `id_type!` newtype）。
- **现状**：持久层实际用裸 `i64` 主键 + JSON payload（`database/mod.rs`），这些类型仅被 `src-tauri/tests/location_contract.rs` 引用。同理 `minecraft/stats_location.rs:55-77` 的 `FutureStatsLocation` / `InvalidStatsLocation` 只服务 `tests/location_contract.rs`；`launcher/mod.rs:25-31` 的 `LauncherAdapter` trait 只有一个实现者。
- **证据**：对上述符号的全仓 grep 只命中定义与 `location_contract.rs`；`launcher/mod.rs:23` 的注释仍写着"HMCL/Prism follow in Phase 5"。
- **改法**：要么让持久层真正使用这些类型（较大改动），要么删除并同步删掉 `location_contract.rs`。属于**需要你决策**的方向。
- **风险/工作量**：M。

### C5（中）同一套分类分类法被编码三次

- **位置**：`src-tauri/src/database/activity.rs:87-99`（`STATISTICS_CATEGORIES`）与 `:101-195`（`statistic_group`，95 行 match + 大段硬编码字符串表）；`src-tauri/src/minecraft/translations.rs:50-173`（`stat_unit`，约 120 行 match）与 `:182-197`（`category_label`）。
- **现状**：分类 id、中文标签、单位、以及 legacy 前缀到分组的映射分散在三处，各自维护。`statistic_group` 还在 `activity.rs:504-509` 与 `:521` 对同一批行重复调用。
- **证据**：`STATISTICS_CATEGORIES` 的 11 个 id 与 `translations.rs:182-197` 的 `category_label` 分支一一对应但字面量重复；`stat_unit` 在 `:68` 递归调用自身。
- **改法**：抽一张统一的分类表（例如 `resources/stat-categories.json` 或一个 `const` 表），由三处共用；`statistic_group` 的结果在遍历时算一次并随行携带。
- **风险/工作量**：M。

### C6（中）迁移有两套并行机制

- **位置**：`src-tauri/src/database/mod.rs:58-83`。
- **现状**：先 `match version` 处理 0/1/2..=6，紧接着又用 `if version < 3/4/5/6` 链补执行。version 2 先被 `2..=6 => {}` 吞掉，再由 `if` 链处理。新增一个迁移要同时改两处，容易漏。
- **证据**：`:58-71` 的 match 与 `:72-83` 的 if 链。
- **改法**：改为单一的迁移列表（`[(3, include_str!(…)), …]`）按 `version` 顺序执行。
- **风险/工作量**：S。

### C7（中）两份样式表有 36 个重复选择器

- **位置**：`src/styles.css`（2342 行）、`src/warmth.css`（482 行），加载顺序见 `src/main.tsx:4-5`。
- **现状**：实测两文件共有 **36 个**同名选择器（`body`、`.app-header`、`.wordmark`、`footer`、`.settings-layout`、`.settings-card`、`.app-nav`、`.app-nav button`、`.tracking-state article`、`.ranking li`、`.health-summary`、`.timeline-events li`、`.status-center` 等），层叠结果依赖"warmth.css 后加载"这一隐式约定。
- **证据**：对两文件顶层选择器集合求交集的实测结果；`warmth.css:1` 的注释自称"Warm, quiet surfaces"，实际覆盖了基础表的排版属性。
- **改法**：合并为一份，或把 `warmth.css` 明确降级为"仅覆盖颜色/背景"并加注释约束；同时抽出设计 token（当前颜色字面量如 `#f7f9fa`、`#20352e`、`#dce4db` 在多处重复）。
- **风险/工作量**：M。视觉回归需要人工核对（仓库已有 `docs/ui-audit-2026-09-08/` 的截图基线可复用）。

### C8（低）重复的小工具与惯用法

- **位置**：`src-tauri/src/commands/startup.rs:30-32` 与 `src-tauri/src/launcher/pcl_folders.rs:111-113`（`wide()` 逐字相同）；`database/mod.rs:118-122, 139-142, 184-188, 201-205` 与 `database/health.rs:96-100`（INSERT 后紧跟 SELECT id 取回主键，共 5 处）；`launcher/sync.rs` 中 `map_err(|_| "PCL 状态锁无效")?` 重复 5 次。
- **现状**：见上。
- **证据**：逐字比对。
- **改法**：`wide()` 提到一个共用模块；INSERT 改用 `RETURNING id` 或 `last_insert_rowid()`（同时消掉 A2/M11 的部分开销）；锁错误串抽成常量或 `From` 实现。
- **风险/工作量**：S。

### C9（低）魔法数字未命名

- **位置**：多处。代表性清单：`tracker/watcher.rs:238`（1024 事件上限）、`:370`（2 s 防抖）、`:321`（3 s 探测）；`scanner/discovery.rs:54`（10,000 预算）、`:122`（256）、`:158`（深度 6）；`runtime_resources.rs:269`（深度 16 / 200,000）、`:339`（`take(200_000)`）、`:374`（8 个归档）、`:996`（64）、`:1142`（1.5 MB）；`commands/scan.rs:90`（15 s）、`:104`（75 ms）；`stable_stats.rs:28-29`（512 / 32 MiB）；`database/activity.rs:281`（LIMIT 50）、`:540`（take 100）、`:213`（4096 / 32768）、`:230`（1024）。
- **现状**：部分已具名（`RECONCILE`、`EXIT_DRAIN`、`MAX_PAIRS`、`MIN_CLONE_TICKS`、`MAX_JAVA_ATTEMPTS`），其余散落为字面量。
- **证据**：上述行号。
- **改法**：逐个提为模块级 `const` 并加一行说明来源；无需改变数值。
- **风险/工作量**：S。

### C10（低）85 个脚本中 67 个无外部引用

- **位置**：`scripts/` 全目录。
- **现状**：实测 85 个文件中 **67 个**除自身外无任何引用（不被 `package.json`、`README.md`、`docs/*.md`、`src/` 或其它脚本引用）。其中 `dump-*.mjs`、`probe-*.mjs`、`patch-*.mjs`、`fix-*.mjs` 明显是一次性调试产物（例如 `patch-end-debug.mjs`、`fix-push-log.mjs`、`insert-java-rust2.mjs`）。
- **证据**：对每个文件名在全仓做引用计数，≤1 的即入选。
- **改法**：把仍在用的生成/校验工具（`build-stat-catalog.mjs`、`export-stat-*.ps1`、`audit-*.mjs` 等，`docs/statistics-resources.md:140-145` 有引用）留在 `scripts/`，其余移入 `scripts/oneoff/` 或删除；同时给 `scripts/README.md` 说明每个保留脚本的用途。
- **风险/工作量**：S。

### C11（低）三个不同的 root 上限没有共享常量

- **位置**：`src-tauri/src/commands/scan.rs:65`（32，且错误文案硬编码"1–32"）、`src-tauri/src/scanner/models.rs:93`（`ScanLimits::roots` 默认 32）、`src-tauri/src/tracker/watcher.rs:442`（256）、`src-tauri/src/scanner/discovery.rs:185`（256）。
- **现状**：同一概念三个数值，且 `scan.rs:65` 的校验与 `models.rs:93` 的默认值各写一遍 32。
- **证据**：上述行号。
- **改法**：定义 `pub const MAX_SCAN_ROOTS: usize = 32;` 与 `pub const MAX_WATCH_ROOTS: usize = 256;`，文案用 `format!` 插值。
- **风险/工作量**：S。

---

## D. 工程质量

### D1（中）`npm run lint` 失败，10 处全在 `scripts/`

- **位置**：`eslint.config.js`；失败文件见"现状核实"。
- **现状**：8 处 `no-unused-vars`（`debug-ferrouslime.mjs:9`、`fix-ghost-qa.mjs:13`、`playwright-entity-render-check.mjs:30,109`、`visual-qa-spider.mjs:27`、`visual-qa-two-box.mjs:2,4`）、3 处 `no-undef`（`visual-qa-box.mjs:40`、`visual-qa-spider-color.mjs:25`、`visual-qa-two-box.mjs:26`，均为 `document`）。
- **证据**：`npm run lint` 输出。本次已修掉我触碰文件上的 7 处（提交 `507f23a`），剩余 10 处属于未触碰文件。
- **改法**：两种取舍——(a) 逐个删除未使用变量、把用 DOM 的脚本加入 `eslint.config.js` 的浏览器全局白名单（与本次做法一致，改动小、语义清晰）；(b) 把一次性脚本移入 `scripts/oneoff/` 并在 config 里整目录忽略（依赖 C10）。推荐 (a)，因为 (b) 会让 lint 覆盖不到仍在使用的工具。
- **风险/工作量**：S。

### D2（中）`npm run format:check` 失败，其中一个文件是语法级失败

- **位置**：`package.json:45`（`prettier: 2.8.8`）；`scripts/visual-qa-spider.mjs:11`。
- **现状**：35 个文件不符合格式；其中 `scripts/visual-qa-spider.mjs` 直接报 `SyntaxError: Unexpected token, expected "(" (11:67)`，因为 prettier 2.8.8 的解析器不支持 `import vanilla from './resources/stat-vanilla-entities.json' with { type: 'json' };` 这种 import attributes 语法。
- **证据**：`npx prettier --check .` 的报错原文；该文件已被 git 跟踪。
- **改法**：升级 prettier 到 3.x（需同步改 `.prettierrc.json` 与 CI 习惯，格式化结果会有大范围 diff），或把该导入改写为 `createRequire` / `readFileSync` + `JSON.parse` 以兼容 2.8.8。其余 34 个文件可一次性 `prettier --write` 解决。
- **风险/工作量**：S（改写单文件）／M（升级 prettier）。

### D3（中）`cargo clippy -D warnings` 失败，9 处 `approx_constant` —— 已修复（第 1 批）

- **位置**：`src-tauri/src/minecraft/runtime_resources.rs:777-785`。
- **现状**：蜘蛛腿旋转角写成字面量 `0.7853982`（=π/4）与 `0.3926991`（=π/8），触发 `clippy::approx_constant`。因为 `README.md:43` 的验证命令带 `-D warnings`，该检查**在 HEAD 即失败**。
- **证据**：`cargo clippy --all-targets --jobs 1 -- -D warnings` 输出 9 个 error + `could not compile`；这些行不在本次提交的 diff 内（`git diff -U0` 的 hunk 只有 `:87`、`:1117`、`:1182`、`:1193`、`:1787`）。
- **改法**：改用 `std::f32::consts::FRAC_PI_4` / `FRAC_PI_8`。注意这些值进入的是 Minecraft 模型 JSON 字面量，替换后需确认序列化结果与原来一致（f32 精度下应当相同），建议跑一次实体图标 QA 比对。
- **风险/工作量**：S。

### D4（中）没有 CI，clippy 的 deny 没有门禁

- **位置**：仓库根（无 `.github`、无 `azure-pipelines.yml`）。
- **现状**：`src-tauri/Cargo.toml:40-42` 声明 `unwrap_used = "deny"`、`expect_used = "deny"`，但只有在开发者本地手动跑 clippy 时才生效。实测这三项检查（lint / format / clippy）当前都是红的，说明本地流程没有真正执行它们。
- **证据**：`Test-Path .github` → `False`；三项红灯见"现状核实"。
- **改法**：加一个最小 CI（Windows runner）：`npm ci` → `npm run typecheck` → `npm run lint` → `npm test` → `npm run format:check` → `cargo fmt --check` → `cargo clippy -- -D warnings` → `cargo test`。修复 D1/D2/D3 后即可全绿。
- **风险/工作量**：M。

### D5（低）`package.json` 没有任何 Rust 脚本

- **位置**：`package.json:6-18`。
- **现状**：12 个脚本全是前端相关；`README.md:41-50` 的验证流程要求手敲 4 条 cargo 命令（含 `--jobs 1` 这类本机特定参数）。
- **证据**：`package.json` 脚本清单。
- **改法**：加 `rust:fmt`、`rust:clippy`、`rust:test`、`verify`（串联全部检查），把 `--jobs 1` 的说明留在 README。
- **风险/工作量**：S。

### D6（低）没有性能回归门禁

- **位置**：`src-tauri/examples/benchmark_scan.rs`。
- **现状**：它输出 `discovery_ms=…` 等指标，但只是 `examples/` 下的可执行文件，不是 `#[bench]` 或 criterion target，没有基线也没有阈值。A1/A2/A4 这类改动因此没有任何自动化的"变慢了"信号。
- **证据**：`Cargo.toml` 无 `[[bench]]` 段、无 criterion 依赖；`benchmark_scan.rs` 用 `println!` 输出。
- **改法**：把它升级为 `benches/` 下的 criterion 基准（至少覆盖 `load()`、`statistics()`、`timeline()` 三条路径），或在 CI 里跑一次并比对阈值。
- **风险/工作量**：M。

### D7（中）测试覆盖缺口

- **位置**：见下。
- **现状**：131 个 Rust 用例覆盖不错，但有明确空洞：
  - `src/desktop.rs` **零测试**：`single_instance`、`InstanceGuard`、托盘 `install` 都没有覆盖，而这里有手工 `extern "system"` 声明与 B7 的 3 秒重试。
  - `resolve_stat_icons` / `store_stat_icon` **从未经 mock IPC 调用**，尽管 `src-tauri/tests/commands_contract.rs` 已经示范了 `mock_builder` 用法。因此 `cache_only` 分支、`java_attempts` 预算、`:1808` 的 `catch_unwind` 恢复路径都无测试。
  - `tracker/watcher.rs` 的 `watch_paths`（决定监控哪些目录的核心函数）没有直接测试；`affected_roots` 有（`scan_optimization_contract.rs:52`）。
  - `launcher/running.rs::read_args`（不安全的 `NtQueryInformationProcess` 解析器）没有畸形输入断言。
  - `commands/pcl_sync.rs`、`commands/preferences.rs` 没有直接命令测试。
  - 前端 `src/lib/` 中 `health.ts`、`pclSync.ts`、`runtimeResources.ts` 无测试文件（`version.ts` 为常量，可忽略）。
- **证据**：对每个符号/文件的全仓引用检查；`#[cfg(test)]` 只出现在 4 个源文件（`runtime_resources.rs:1831`、`stats_parser.rs:161`、`startup.rs:131`、`launcher/sync.rs:348`）。
- **改法**：优先补 `resolve_stat_icons` 的 mock IPC 测试（B11/A4 的改动都需要它做回归网）与 `watch_paths` 的单元测试；`desktop.rs` 至少覆盖 `InstanceGuard` 的句柄释放。
- **风险/工作量**：M。

### D8（低）测试套件隐式依赖 PowerShell 7+

- **位置**：`src-tauri/tests/support/mod.rs:79-81`。
- **现状**：测试用 `pwsh -CommandWithArgs` 创建目录联接，但 `Cargo.toml` 的 `[dev-dependencies]` 只声明了 `tauri` 与 `tempfile`；`-CommandWithArgs` 需要 PowerShell 7+，Windows PowerShell 5.1 不支持。README 未提及该前提。
- **证据**：`support/mod.rs:80` 的参数；`README.md:14` 的前置要求只列了 Node/Rust/MSVC/WebView2。
- **改法**：在 README 的验证环境里补一行"PowerShell 7+"，或改用 Rust 侧的 `std::os::windows::fs::symlink_dir` / junction crate 消除外部依赖。
- **风险/工作量**：S。

### D9（低）`crate-type` 含桌面应用不需要的产物

- **位置**：`src-tauri/Cargo.toml:9-10`。
- **现状**：`crate-type = ["staticlib", "cdylib", "rlib"]`。桌面应用只需要 `rlib`（集成测试用）+ Tauri 的构建方式；`staticlib`/`cdylib` 是移动端模板的遗留，会增加构建时间与磁盘占用。
- **证据**：`Cargo.toml` 声明；仓库无 iOS/Android 目标配置。
- **改法**：改为 `["rlib"]`（保留 `cdylib` 若 `tauri build` 需要），实测一次 `desktop:build` 确认无回归。
- **风险/工作量**：S。

---

## 建议实施顺序

按"风险低、收益明确、能解锁后续项"排序。第 1 批已完成（见上文"已完成"）。

**第 1 批——低风险高收益（已完成）**

1. ~~**B10** 玩家偏好从未保存（功能缺陷，与文档不符）。~~
2. ~~**B1** 命令改 `async` + `spawn_blocking`（机械改动，消除主线程阻塞）。~~
3. ~~**B2** 加 ErrorBoundary（避免白屏）。~~
4. ~~**B3** 修 watcher 静默丢事件。~~
5. ~~**D3** 修 9 处 clippy（让 `-D warnings` 恢复绿灯）。~~ 实际修了两层：9 处 `approx_constant` + 被它掩盖的 65 处测试 `unwrap`。
6. **D5** 补 `package.json` 的 Rust 脚本。（仍未做）

**第 2 批——数据库基础，为 A1 铺路**

7. **A3** 常驻连接 / WAL。
8. **A2** 去掉 `load()` 的 N+1。
9. **B6**、**B8**、**B9**（都依赖 A3 的常驻连接）。

**第 3 批——扫描与图标**

10. **A5** 发现阶段去 O(n²) 与 Setup.ini memo。
11. **A4** 拆分图标解析的锁粒度。
12. **B11** 给"完整检查"分批（本次提交的配套加固）。

**第 4 批——需要设计取舍，单独排期**

13. **A1** 统计聚合下沉（需先补 D6/D7 的回归网）。
14. **A8** 快照保留策略（与 A6 一起设计）。
15. **A11** Tailwind 去留（需你确认方向）。

**第 5 批——清理，可与上面并行**

16. **D1**、**D2** 修 lint/format（D2 需先决定 prettier 升级与否）。
17. **C1** 拆分 `runtime_resources.rs`；**C2**、**C3**、**C6**、**C8**、**C11** 抽公共逻辑。
18. **C10** 归档一次性脚本；**C7** 合并样式表（需视觉核对）。
19. **D4** 加 CI（在 D1/D2/D3 全绿之后）。

---

## 附录：本次未做的事

- 未运行 `npm run desktop:build` 或 `desktop:package`。因此 `D:\MineChronicleApp\minechronicle.exe` 仍是**修复前**的 0.10.12 构建；要看到 UV 修正后的图标，需要重新构建并安装。
- 未修改任何游戏文件；对 `D:\MineChronicleData\minechronicle.sqlite3` 只做了只读查询。
- 未评估 `docs/` 下历史文档的时效性，也未核对其中的数值是否仍与当前档案一致。
- 未对 A1/A4/A8 的改法做原型验证；工作量估计基于代码规模与调用点数量，不是实测工时。
