# Phase 3：本地档案与扫描修复

版本：0.3.0。范围为 SQLite schema、版本化 migration、Repository 和 initial import，同时处理路径显示、上层目录发现和玩家名称。本阶段不包含 PCL2 Adapter、文件监控、增量追踪、回档处理或复制世界去重。

## 使用

打开 `src-tauri/target/debug/minechronicle.exe`，输入 `.minecraft`、实例集合或包含 `saves` 的目录，点击“扫描并保存”。自动发现会寻找输入目录自身以及下层的游戏根目录，包括 `versions/<实例>/saves/<世界>` 和 `instances/<实例>/.minecraft/saves/<世界>`。重启后恢复输入目录和已经保存的世界、玩家及首次历史。

玩家同时显示名称和 UUID。明确设置的手动别名优先于本地 `usercache.json`；未发现新名称时保留数据库内已知名称，未知玩家显示“名称未解析”，可点击“设置名称”。名称不是身份主键，不会将同名 UUID 合并。不查询网络，不读取认证配置。

Windows 的 `\\?\` 和 `\\?\UNC\` 仅在展示时转换成普通路径。内部完整路径与文件身份不受影响，路径尾部空格不会被展示函数删除。开发和正式构建都使用 Windows GUI 子系统。

## 扫描边界

- 输入最多 32 个绝对目录，禁止整个磁盘根目录。
- 自动发现最多深入 6 层，共检查最多 10000 个条目，发现最多 256 个游戏根目录。达到限制会显示问题记录。
- 跳过 saves、assets、libraries、mods、resourcepacks、shaderpacks、logs、backups、region 等无关或大型目录。只在发现根目录后由 WorldScanner 读取 saves 下的世界。
- 不跟随扫描树内的符号链接和目录联接；用户明确选择的目录别名通过规范化和文件身份去重。
- 名称只读取根目录到用户选择边界之间的 `usercache.json`，每个缓存上限 2 MiB；仅提取有效 UUID 和名称，不保存其他字段。最近一层有效缓存优先，同一个缓存中的冲突名称不会被采用。
- 取消扫描不执行导入。扫描某个根目录不完整时，不据此将已有世界标成缺失。未被本次发现的旧根目录也不会推断为被删除。

## 存储

Windows 默认数据库：`%APPDATA%/dev.minechronicle.desktop/minechronicle.sqlite3`。只创建和写入 MineChronicle 的应用数据目录。

`database/001_initial.sql` 在事务内创建首版 schema，使用 SQLite `user_version=1`。正常重启不重建表；遇到更高版本拒绝打开，保留原始内容。开启外键，数据库锁等待上限 5 秒。

已有 15 张表：launcher_installations、game_roots、instances、worlds、instance_world_links、players、player_aliases、world_players、stat_snapshots、tracked_deltas、scan_runs、anomalies、clone_candidates、world_lineages、settings。后续阶段的专用表本阶段不写入虚构数据。

一个完整扫描的保存操作使用同一事务：根目录和世界、玩家、当前读数、首次快照、问题记录、输入设置一起提交。任何写入失败都会回滚。重复扫描可更新当前读数，但 `(world_id, player_uuid)` 的 initial_import 由唯一索引限制为一次。快照保存整数 ticks 和完整规范统计 JSON，当前读数单独存储。

仅在根目录完整扫描后，才把未出现的旧世界标记为 Missing；不删除其世界、玩家或快照，路径恢复后仍沿用首次历史。无法解析的当前统计不会被视为零；冲突来源保留路径和问题，解决后才能创建首次基线。

汇总是所有已导入世界和玩家的首次读数之和，包含缺失世界，尚未扣除复制世界。不能把它当作已经去重的个人生涯总时长。数据库计数使用 INTEGER，Rust 汇总使用 i128，IPC 用十进制字符串，界面使用 BigInt。

## 验证

Rust 63 项测试、前端 27 项测试通过。测试均使用合成数据和临时数据库，不依赖用户电脑上的 Minecraft 内容。

新增验证覆盖：版本迁移与更高版本拒绝、重新打开、重复导入、基线不可变、事务回滚、缺失世界恢复、不完整和取消扫描、来源冲突解决、手动别名优先、跨扫描大小写路径、超出 i64 的汇总、嵌套目录发现、遍历边界、名称缓存范围和损坏处理。Tauri 注册命令测试覆盖 scan_game_roots、load_library、set_player_alias。

前端使用实际 React 页面和合成 IPC 在本地 Edge/Playwright 验证路径显示、名称与 UUID、编辑名称和恢复展示，并检查 1080 和 600 像素窗口。浏览器验证的 IPC 是模拟数据；SQLite 持久化由真实 Rust 集成测试验证。无页面异常和控制台错误。

检查命令：cargo fmt、cargo clippy --all-targets -D warnings、cargo test、npm run typecheck、npm run lint、npm test、npm run format:check、npm run tauri build -- --debug --no-bundle。Windows 可执行文件另做 GUI 子系统和启动响应检查。安装器与签名留给 Phase 10。
