# MineChronicle

面向 Minecraft Java Edition 多实例玩家的本地生涯统计桌面软件。

在“导入与设置 → 自己”中，可填写玩家名称或 UUID（支持带或不带连字符）。保存后，生涯概览、时间线和更多统计的玩家列表顶部会提供“自己”快捷项。名称按本地档案完整匹配且不区分大小写，多个同名账号会一起选中；填写 UUID 则仅选择对应账号。未导入的身份可先保存，留空保存可清除配置。
**当前版本 0.10.12：自己身份保存到本地 SQLite 档案；实例观测独立页面直接读取持久化历史；数据健康移至导入与设置末端；概览、时间线与更多统计同步玩家选择。**

本版行为与验证范围见 [PCL 追踪与观测时段](docs/pcl-tracking-0.10.10.md)。

更多统计的译名、图标来源和生成方式见 [统计资源说明](docs/statistics-resources.md)。

## 开发运行

本次验证环境：Windows x64、Node.js 24、npm 11、Rust 1.97、MSVC 和 WebView2。
系统构建依赖参考 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)。

```powershell
npm ci
npm run tauri dev
```

仅预览前端：`npm run dev`，打开 `http://127.0.0.1:1420`。
浏览器中的“检查桌面连接”会明确提示预览模式；桌面版通过真实 Tauri IPC 获取后端状态。

```powershell
$env:CARGO_BUILD_JOBS = '1'
npm run desktop:build
```

生成包含前端资源的开发版 `src-tauri/target/debug/minechronicle.exe`。
限制 Cargo 并行度可降低 Windows 构建的提交内存峰值，避免资源不足引起的元数据映射或误导性的依赖版本错误；同样适用于安装包构建。更新统计资源后，应先完成图标生成，再重建桌面程序；仅构建前端不会更新已有 exe。
执行 `npm run desktop:package` 生成 Windows x64 NSIS 安装包，输出到 `src-tauri/target/release/bundle/nsis/`；发行版程序位于 `src-tauri/target/release/minechronicle.exe`。安装器按当前用户安装，默认无需管理员权限。已安装 WebView2 的机器可离线使用；缺少 WebView2 时安装器会获取微软运行库。本次安装包未作数字签名。

开发依赖获取可使用 `npm ci --registry=https://registry.npmmirror.com`。
本机 `.cargo/config.toml` 使用既有 USTC 缓存，已被 Git 忽略；源码默认使用 crates.io。
运行中的产品不需要包管理镜像或外部网络。`lightningcss` 暂锁定为 1.32.0，
避免本机初次中断安装留下的新版本可选二进制缺失；已验证生产构建。

## 验证

一条命令跑完全部检查（TypeScript、ESLint、Vitest、Prettier、rustfmt、Clippy、Rust 测试）：

```powershell
npm run verify
```

Rust 测试在 Windows 上用 `cmd /C mklink /J` 创建目录联接来验证扫描器不会跟随链接。这是系统自带的 `cmd` 内建命令，不需要 PowerShell，也不需要开发者模式或管理员权限（联接与符号链接不同）。

需要 `cargo` 在 PATH 上（Rust 默认安装位置为 `%USERPROFILE%\.cargo\bin`）。单项也可单独运行：

```powershell
npm run rust:fmt      # cargo fmt --check
npm run rust:clippy   # cargo clippy --all-targets --jobs 1 -- -D warnings
npm run rust:test     # cargo test --jobs 4
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
```

`--jobs 1` 用于 Clippy，避免 Windows 上的提交内存峰值；Rust 测试用 `--jobs 4`。
Rust 测试只使用合成 JSON 与仓库内 fixture。不会读取真实 Minecraft 数据；另有经用户授权的实际程序验收。
完整范围和验证记录见 [Phase 1 说明](docs/phase-1.md)、[Phase 2 说明](docs/phase-2.md)、[Phase 3 说明](docs/phase-3.md)、[Phase 4 说明](docs/phase-4.md) 与 [Phase 6 说明](docs/phase-6.md)。

## 当前能力

- Tauri 2、Rust、React、TypeScript、Vite、Tailwind CSS 工程与离线基础页面。
- `Launcher → Instance → GameRoot` 与 `GameRoot → World` 分离；玩家用 UUID 标识。
- 纯内存 `StatsParser` 接口，按字段结构选择三代格式，统一为非负 `i64` ticks。
- 八项核心计数、通用分类数值查询，以及未知分类、模组扩展与旧成就数据保留。
- 字段冲突警告、重复 JSON 键拒绝、大小限制与结构化错误。
- 旧版 `stats`、26.1 `players/stats` 与显式未来布局接口。
- GameRoot/World 只读扫描，Windows 128 位文件身份去重，处理大小写、`..`、明确选择的目录联接。
- Gzip/原始 NBT 世界元数据读取；损坏或缺少 level.dat 时可用合法统计发现降级世界。
- 手动指定根目录、后台扫描、实时进度、取消、玩家时长与问题展示；同 UUID 的冲突来源不相加。
- Windows 开发版与正式版均使用 GUI 子系统，不再随程序启动弹出控制台。
- 支持输入 `.minecraft` 或实例集合目录，自动发现下层 `versions/<实例>/saves` 等布局；限制深度和条目数量，不跟随内部目录联接。
- 界面隐藏 Windows 扩展路径前缀；内部仍用完整规范路径识别目录。
- 离线读取范围内的 `usercache.json`，显示名称、UUID 和来源；支持持久化手动别名。
- SQLite 版本化迁移、事务导入、不可重复累加的首次历史快照；保留缺失世界历史，重新出现时恢复。
- PCL 新旧隔离设置、全局规则、Minecraft 版本与 Forge / NeoForge / Fabric / Quilt / OptiFine 元数据；实例与共享根目录分别保存。
- 时长显示到秒；小于 1 秒的非零读数单独提示，原始 ticks 可见。相同原因的扫描问题只展示一次，涉及路径默认折叠。
- 支持将档案迁移到其他磁盘，SQLite 快照复制、完整性校验后切换位置。
- Rust 命令注册集成测试、前端 IPC 边界测试，以及整数 ticks 的 BigInt 展示工具。

## 架构与阶段边界

```text
src/                       React 基础页面与前端测试
src-tauri/src/
  domain/                  Instance、GameRoot、World、Player、标准统计
  minecraft/               JSON Parser、路径候选接口
  launcher/                LauncherAdapter 契约和 PCL 元数据适配器
  commands/                前端调用的后端状态命令
  scanner/                 目录身份、有限深度扫描、结果与问题模型
  database/                SQLite 迁移、Repository、持久化读取模型
  tracker/                 notify 文件监控、BLAKE3 快照与正向增量
src-tauri/tests/            合成数据和集成测试
```

rusqlite 使用内置 SQLite；fastnbt、flate2、walkdir 用于只读扫描。
ECharts 用于带动画的排行图；notify 和 BLAKE3 用于本地观察。系统减少动态效果设置会关闭界面和图表动画。
历史、当前读数与追踪增量分别保存。复制候选只自动检测，经用户复核后建立关联；继承时长未知时不扣减统计。没有 HMCL/Prism 专用适配器。

## 隐私约束

应用层仅在用户指定目录和 PCL 已保存的文件夹范围只读扫描游戏文件，没有写入游戏文件的命令、网络插件、遥测、账号或认证配置读取。
Stats Parser 仅处理调用方提供的字节，不持有文件路径。
数据库默认位于 `%APPDATA%/dev.minechronicle.desktop/minechronicle.sqlite3`，迁移后由同目录的小型 `storage.json` 指向其他磁盘上的档案；指定磁盘不可用时拒绝创建空档案。仅 MineChronicle 的档案会被写入。PCL 配置只提取白名单内的版本/隔离字段，不读取独立认证文件或保存登录数据，不联网查询玩家名称。统计 IPC 使用十进制字符串传递 `i64`，汇总使用更宽整数，避免 JavaScript `number` 精度损失。

## 后续阶段

Phase 7 已完成，并在 Phase 10 优化：约每 3 秒匹配运行中的 Minecraft 游戏目录与 PCL 实例，仅监控活动根目录；文件事件 2 秒防抖，5 分钟补偿检查也仅覆盖活动实例。退出实例后补读最终存档并撤销监控。无运行实例时停止世界扫描。手动扫描仍可更新全部档案。正向变化累计，回档保留且不扣减追踪时长。详见 [Phase 7](docs/phase-7.md) 和 [Phase 10](docs/phase-10.md)。
Phase 8 已完成：严格复制候选、可撤销复核、用户确认的世界关联、数据健康问题列表；世界页按实例根目录折叠并分页。扫描会复用有效 PCL 配置，手动扫描优先，取消后保留已保存列表。详见 [Phase 8](docs/phase-8.md)。HMCL / Prism 按用户要求暂缓。

Phase 9 已完成：时间线区分首次导入、追踪基线、正向增长、回档与其他统计变化；支持世界、实例根目录、玩家、日期和事件筛选。更多统计提供八项主要计数、移动距离和模组分类查询，区分最近读数与首次历史。详见 [Phase 9](docs/phase-9.md)。

Phase 10 隐藏零秒基线及无时长增长事件，保留回档和有效导入记录。生涯概览与排行按最近有效读数计算，默认选中 Jasonsomelike（`b0e9bd79-52ec-45c0-ad53-d92995098e1d`）；可组合多个 UUID，并在概览、时间线和统计间保留选择。统计表保留原始键，同时显示收录的中文名称，支持中文搜索。验证范围及资源采样见 [Phase 10](docs/phase-10.md)。

项目按 MIT 许可证开放源代码。

PCL 联动入口：PCL 实例 → PCL 自动联动。Rust 后台服务读取注册表 `HKCU\Software\PCL\LaunchFolders`、`PCL/Setup.ini`、版本配置及 JSON，每 15 秒检查配置变化，启动时和变化后同步实例及存档。可暂停、立即同步或选择配置目录；PCL 关闭后复用已保存配置。无需额外脚本，不弹出命令行窗口。Rust 测试后请重新运行 `npm run desktop:build`，再双击 exe。
