# Phase 1 开发记录

## 范围

根据开发说明从空目录建立工程，仅实施 Phase 1。
没有扫描真实游戏目录，没有实现 Phase 2–10 的业务功能。

## 主要文件

| 路径                                                     | 作用                                                    |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `package.json`、`package-lock.json`                      | 前端依赖锁定、开发与质量检查命令                        |
| `vite.config.ts`、`tsconfig.json`、`eslint.config.js`    | Vite/Tailwind、严格 TypeScript、ESLint                  |
| `src/App.tsx`、`src/styles.css`                          | 中文阶段说明与可操作的桌面连接检查                      |
| `src/lib/runtime.ts`                                     | 真实 Tauri IPC；浏览器环境明确返回预览状态              |
| `src/lib/duration.ts`                                    | 十进制 ticks 字符串以 BigInt 展示，不经过浮点小时存储   |
| `src-tauri/Cargo.toml`、`Cargo.lock`                     | Tauri 2 和 Rust 依赖                                    |
| `src-tauri/tauri.conf.json`、`capabilities/default.json` | 桌面窗口、离线 CSP、基础权限                            |
| `src-tauri/src/domain/`                                  | 分离实例、根目录、世界与 UUID 玩家身份                  |
| `src-tauri/src/minecraft/stats_parser.rs`                | 三代解析、八项计数与错误处理                            |
| `src-tauri/src/minecraft/unique_json.rs`                 | 递归拒绝重复 JSON 键，防止静默覆盖                      |
| `src-tauri/src/minecraft/stats_location.rs`              | Legacy、Modern26、显式 Future 路径候选                  |
| `src-tauri/src/launcher/mod.rs`                          | 元数据发现契约，不解析统计                              |
| `src-tauri/src/commands/mod.rs`                          | Phase 1 状态命令                                        |
| `src-tauri/src/{scanner,database,tracker}/`              | 后续阶段边界说明，没有假实现                            |
| `src-tauri/tests/`                                       | 合成 fixtures、解析/路径/命令集成测试、Windows 测试清单 |

## 解析契约

1. 依次检查 `stat.playOneMinute`、`minecraft:play_time`、`minecraft:play_one_minute`；不以版本号选择。
2. 所有已出现的时长字段必须是非负 `i64`。同时存在且数值不同时保留优先值，并返回冲突警告。
3. 没有任何支持的时长字段返回 `UnknownFormat`，不伪造零时长；已知其它计数缺省值为零。
4. 不允许将负数、小数、字符串、布尔值、null 或溢出整数作为核心计数。
5. `statistics` 保留现代分类，`legacy_statistics` 保留旧平铺统计，`extra_fields` 保留其它顶层字段。
   旧平铺统计可通过 `statistic("legacy", key)` 查询；模组分类不会被旧统计覆盖。
6. 单次 JSON 最大 16 MiB；超限、损坏、重复键与无效 UTF-8 返回错误。错误不附带原始 JSON 内容。
7. Parser 无文件、网络、数据库或全局状态；重复调用不会累计数值。
8. 现有 Stats 结构体是领域/存储模型，不应直接作为未来统计 IPC 的 JSON number DTO。
   未来命令需单独以十进制字符串传输 `i64`，前端展示工具已提供。

## 测试范围

Rust：25 项，2 个模块单元测试、18 个解析契约测试、4 个路径/领域集成测试、1 个 Tauri 命令集成测试。
前端：15 项，12 个整数时间展示测试、3 个 IPC 环境/成功/失败边界测试。
命令集成测试使用 Tauri MockRuntime，只替代窗口运行环境，实际执行本应用的注册处理器和 Rust 命令。
前端 IPC 测试使用 Tauri 官方 mock；核心 Parser 从未被 mock。

覆盖：1.12、1.16、1.21、26.1 结构；两种路径；缺少 level.dat；多玩家；未知统计；
损坏 JSON；冲突键与重复键；整数边界；重复/重排输入；回退数值序列；共享 GameRoot 领域关系。

以下不属于本次测试通过的含义：

- `200 → 180 → 183` 测试只证明 Parser 如实读取当前计数；尚未实现 tracked delta。
- 多实例测试只验证它们能引用同一 GameRoot；尚未实现 Windows canonical path、目录联接或扫描去重。
- 缺少 level.dat 的 fixture 证明解析不依赖世界元数据；尚未实现 degraded world 的导入流程。
- 重排输入测试证明标准结果相等；尚未实现 BLAKE3 hash、snapshot 去重或世界 lineage。

## 本机检查结果（2026-09-06）

- `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`。
- `npm run typecheck`、`npm run lint`、`npm test`、`npm run format:check`、`npm run build`。
- `npm run tauri build -- --debug --no-bundle` 生成 Windows 开发版程序。
- 内置浏览器验证页面渲染与“检查桌面连接”交互，正确显示预览模式。
- 开发版 `.exe` 启动后观察 5 秒，进程保持运行，窗口标题为 MineChronicle，响应状态正常；检查后关闭测试进程。

首次中断的 npm 安装已保留在 Git 忽略的 `.dependencies-interrupted/` 与
`.package-lock-interrupted.json`，当前运行使用重新生成的 `node_modules/` 与 `package-lock.json`。
没有修改系统代理、证书验证策略或用户游戏数据。

## 后续

Phase 2 开始前重新阅读代码，实施只读扫描与 NBT 世界元数据解析。
shadcn/ui 与 ECharts 在基础 Dashboard 阶段接入；其它既定依赖按对应阶段引入。
