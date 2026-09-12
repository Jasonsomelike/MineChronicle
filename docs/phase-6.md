# Phase 6：基础 Dashboard 与 PCL 联动修复

版本 0.6.0。按用户要求暂缓 Phase 5（HMCL / Prism），完成 PCL 联动修复后进入基础 Dashboard。

## PCL 文件夹与实例

原适配器只发现选定目录下的实例，漏掉 PCL 管理的跨盘游戏文件夹。现在通过 Windows 原生只读 API 获取 `HKCU/Software/PCL` 的单个 `LaunchFolders` 值，按 `名称>路径|名称>路径` 解析。不会枚举账号或令牌值。另通过进程列表和可执行文件路径识别运行中的 PCL，不读取命令行、进程内存或登录配置。

参考 [PCL 官方文件夹加载与隔离代码](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModMinecraft.vb) 和 [设置定义](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Pages/PageSetup/Settings.vb)。目录来自已保存的列表及运行中启动器附近的版本容器，不遍历磁盘。多个 PCL 同时运行时由界面选择全局设置来源；没有运行实例时保留已保存的列表，并明确提示全局配置尚未确认。

“读取 PCL 文件夹”填入扫描范围，“扫描并保存”只读扫描后写入 MineChronicle 档案。确认的版本容器直接枚举实例，不继续深入模组缓存、地图缓存、备份等目录耗尽发现额度。PCL 适配器只提供元数据；统计仍由原 Scanner/Parser 处理。普通手动路径编辑会取消已选的 PCL 全局上下文，避免把其他启动器误标为 PCL。

实例按文件夹分组并可搜索，显示名称、Minecraft / Loader 版本、隔离依据和实际游戏根目录。没有再次扫描的记录保留最近已知结果，界面明确标记为已保存数据；这不是启动器进程计时或启动游戏功能。

## Dashboard

- 生涯概览、PCL 实例、世界与玩家、导入与设置四个页面。
- 按 UUID 筛选玩家，显示名称和短 UUID；同名玩家仍独立。
- 首次导入历史、当前可读存档合计、世界与玩家数量。
- Top Worlds、按游戏根目录合并的 Top Instances；点击排行进入对应世界。
- ECharts SVG 排行图，旁边提供精确秒数与可访问的文字列表；图表按比例展示，汇总与排序始终使用 BigInt。
- 当前扫描问题按原因分组，保留折叠路径详情；提供缺失世界和不可用当前读数计数。

历史与当前读数不相加。已缺失世界保留首次历史，但不计入当前读数；不同路径下的同名世界保持独立。共享根目录只统计一次，无法区分来自某个实例的时长时合并显示。复制世界识别尚未实现，不能把总量称为已去重的精确生涯时长。周/月/安装后追踪显示“尚无追踪数据”，不会从导入时间推断游玩日期。

## 构建与验收

补上 Cargo `custom-protocol` 功能映射，`npm run desktop:build` 同时打包前端与后端，生成可双击的 `src-tauri/target/debug/minechronicle.exe`。运行界面与后端校验版本，启动记录和界面回执位于档案旁的 `last-startup.json` / `last-view.json`，用于核验实际 exe、内置页面和数据库路径。

必须在最后一次 Rust 测试之后执行桌面构建：Cargo 测试也可能生成同名开发态 exe。Windows 所有构建使用 GUI 子系统。安装器和签名仍属于 Phase 10。

自动测试涵盖跨目录 PCL 配置、中文文件夹及目录去重、隔离优先级、未知配置、共享世界首次快照、运行版本回执、大整数合计、UUID 筛选、缺失与不可读数据、同名世界。全部测试使用临时合成数据；真实用户档案验收是另行授权的本地只读扫描和 GUI 操作。

下一阶段为 Phase 7：文件监控、Snapshot、Delta 与回档处理。HMCL / Prism 保持暂缓。
