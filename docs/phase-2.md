# Phase 2：只读存档扫描

## 完成内容

本阶段在 Phase 1 基础上增加 GameRootScanner、WorldScanner 和 level.dat reader，并接入最小可用扫描界面。没有进入 Phase 3 数据库开发。

- Windows 入口统一使用 GUI 子系统，Debug/Release 程序均不附带控制台。
- 只扫描明确指定的绝对游戏根目录下的 `saves`，再读取一层世界目录与两种统计目录。拒绝磁盘根目录，不搜索启动器，不遍历 region。
- 路径先进行系统 canonicalize，再用文件身份去重。Windows 使用卷序列号与 128 位 FILE_ID_INFO；Unix 使用 dev/inode。扫描期间保持根目录句柄打开，避免 ID 复用。
- 通过 fastnbt/flate2 读取原始或 Gzip NBT：LevelName、DataVersion、Version.Name、LastPlayed。没有世界名则回退目录名。
- `level.dat` 缺少或损坏但有合法玩家统计时返回 Degraded 世界。单个损坏文件记录问题，其它文件和世界继续扫描。
- 以 UUID 分组 `stats` 和 `players/stats` 来源。完全相同的解析结果只产生一个玩家读数；不同来源保留全部内部解析数据，汇总读数为 null，明确提示冲突。
- 统计来源冲突不自动合并，不计算跨世界总生涯时长。尚未进行 Clone Candidate Detection。
- Tauri 命令使用后台线程和 Channel 推送进度，支持取消与防重复扫描。IPC 时长用十进制字符串，避免精度丢失。
- 前端展示根目录、世界、UUID、当前时长、版本与问题；每组最多渲染前 100 项并明确提示显示限制，内部扫描结果不因此丢弃。

## 主要文件变更

| 路径                                                                              | 内容                         |
| --------------------------------------------------------------------------------- | ---------------------------- |
| `src-tauri/src/main.rs`                                                           | Windows 静默启动             |
| `src-tauri/src/minecraft/level_dat.rs`                                            | 有界文件读取、Gzip/NBT 解析  |
| `src-tauri/src/scanner/path_identity.rs`                                          | 原生文件身份与链接检测       |
| `src-tauri/src/scanner/game_root.rs`                                              | 指定根目录去重与扫描编排     |
| `src-tauri/src/scanner/world.rs`                                                  | 世界、玩家与冲突统计来源发现 |
| `src-tauri/src/scanner/fs_access.rs`                                              | 单层有界枚举、只读路径检查   |
| `src-tauri/src/scanner/models.rs`                                                 | 扫描结果、进度、问题与上限   |
| `src-tauri/src/commands/scan.rs`                                                  | 后台扫描、取消与精确 IPC DTO |
| `src/components/ScanPanel.tsx`、`src/lib/scan.ts`                                 | 手动扫描与结果展示           |
| `src-tauri/tests/support/`                                                        | 运行时合成 NBT/存档 fixture  |
| `src-tauri/tests/{level_dat_contract,scanner_contract,scan_commands_contract}.rs` | 新增集成测试                 |

## 边界与限制

- 尚未保存任何历史数据库；关闭页面即失去本次显示结果。没有初次历史导入、回档 delta、missing 状态持久化或 world lineage。
- 授权根目录自身可以是目录联接；其内部的符号链接/reparse points 默认跳过并报告。若需要读取其目标，需直接指定目标所在游戏根目录。
- 遇到不支持文件身份查询的文件系统会报告目录不可访问，不退回不可靠的字符串猜测。
- 默认最多 32 个根目录、每根目录 10,000 个世界条目、每世界 10,000 个统计目录条目。达到上限会记录部分扫描问题。
- Stats 单文件上限 16 MiB；level.dat 文件上限 16 MiB，解压后上限 32 MiB。NBT 未知业务字段由解析器跳过，不参与世界版本推断。
- 取消只在扫描边界检查，不能中断操作系统正在执行的单次文件读取；之后不会继续扫描下一项。
- 数据缺损、访问失败、冲突、链接跳过或上限问题会将根目录标记不完整，防止后续数据库误把不可读世界当作删除。明确的“缺少 level.dat 但统计有效”降级情形除外。
- Phase 2 仅提供单次扫描；Minecraft 写入中的临时损坏会显示问题，可以重新扫描。防抖 watcher 与自动重试属于 Phase 7。

## 验证

Windows x64 本机使用合成数据验证；不依赖真实 Minecraft 文件。Windows 联接测试使用 PowerShell 7 创建临时目录联接，无需管理员权限。

- Rust：47 项测试，包括原有 25 项、新增 4 项 NBT、14 项 Scanner、4 项扫描命令测试。
- 前端：23 项测试，包括 8 项路径输入/扫描 IPC 新测试。
- 实际 Tauri InvokeRequest 验证注册的扫描命令能读取临时存档，并将 i64::MAX 精确序列化为字符串。
- 验证后台进度、取消后可重新扫描、无效输入拒绝。
- 验证 Windows 大小写、`..`、目录联接和共享 GameRoot 只扫描一次。
- 验证损坏/缺失 level.dat、多玩家、重复统计目录、冲突来源、损坏 JSON、未知格式、锁定文件、目录限制与取消。
- 对所有合成源文件进行扫描前后路径和内容比对，证明没有创建、删除或修改源文件。
- 内置浏览器验证空输入错误和浏览器模式拒绝读取文件；不以浏览器 mock 结果代替 Rust Scanner 测试。

质量检查命令沿用 README：Rust fmt/clippy/test，前端 format/typecheck/eslint/test/build。
开发版构建命令：`npm run tauri build -- --debug --no-bundle`。正式安装器仍留到 Phase 10。

交付版本为 0.2.0，程序路径为 `src-tauri/target/debug/minechronicle.exe`。
已通过 PE 程序头确认 `subsystem (Windows GUI)`；启动后观察 5 秒，窗口标题正确且进程正常响应，检查后关闭测试进程。

开发环境临时使用 Node 的正常 TLS 验证从 USTC 镜像补齐 Cargo 缓存，并逐包校验 SHA-256；没有修改系统代理、信任证书或吊销检查设置。该帮助脚本位于 Git 忽略的 `.local/`，不随产品打包。
