# Phase 4：PCL 适配、秒级显示与档案迁移

本文记录版本 0.4.0 的阶段状态；跨盘目录联动及最终桌面构建修复见 [Phase 6](phase-6.md)。

版本 0.4.0。已完成 PCL 元数据适配，并修复重复警告和不足一分钟显示为零的问题。

## 时长与提示

所有时长使用整数 ticks，经 BigInt 转换后显示小时、分钟、秒，不再截断到整分钟。364 ticks 显示为 0 小时 0 分钟 18 秒，1–19 ticks 显示“不足 1 秒”。界面同时显示原始 ticks。历史快照没有修改，也没有把世界总时间替换为个人游玩时间。

统计解析仍按字段结构识别 `stat.playOneMinute`、`minecraft:play_one_minute`、`minecraft:play_time`；三个字段以 ticks 为单位，不能因为名称包含 minute 就改成分钟。合成测试包含 DataVersion 4903 和不足一分钟读数，保证不同布局、字段名称和版本信息不会丢失精度。

相同问题类型和消息按原因分组，只展示一次；涉及路径在折叠详情中显示。此行为也适用于旧档案里的重复扫描问题。自动发现额外跳过 .mixin.out、动态数据包缓存、JourneyMap、Xaero 等目录。已识别但尚无 saves 的 PCL 实例不再产生“缺少 saves”警告，其扫描完整性仍保守处理。

## PCL 适配

输入 PCL 所在目录、`.minecraft` 或实例集合时，扫描过程会识别 `versions/<实例>/PCL/Setup.ini`，并在授权目录边界内查找全局 `PCL/Setup.ini` 或 `PCL.ini` 标记。读取实例版本 JSON 的版本号和 libraries 信息，必要时使用 PCL 的 VersionOriginal、VersionForge、VersionNeoForge 等白名单缓存字段补齐元数据。

隔离设置优先采用 VersionArgumentIndieV2；旧版实例值 1/2 对应隔离/共享。未显式指定时，根据现有 mods/saves 内容以及可读取的全局隔离规则判断。缺少足够配置或配置损坏时给出问题记录，不擅自选择根目录。JSON 提供的明确加载器信息优先，支持 Forge、NeoForge、Fabric、Quilt 和 OptiFine。

实现参考 [PCL 官方 PathIndie 逻辑](https://raw.githubusercontent.com/Hex-Dragon/PCL2/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModMinecraft.vb)。适配器只负责实例元数据，GameRootScanner 和 StatsParser 分别处理世界文件和统计内容。

边界：不读取注册表中的自定义目录列表，不跟随配置指向授权范围之外的目录，不读取登录数据，不发起网络请求。若只选择 `.minecraft`，其父目录的全局配置不在授权范围内；明确的实例自身设置仍可使用。要读取全局规则，可输入 PCL 所在目录。没有 PCL 证据的目录继续按通用目录扫描。

SQLite schema 升至版本 2，为实例增加唯一路径与元数据，保存 Launcher → Instance → GameRoot 与 Instance/World 展示关联。共享同一个 GameRoot 的实例不会增加世界数量或重复创建首次历史。迁移只追加字段和索引，不重建历史表。未再次发现的实例保留最近已知信息。

## 档案迁移

迁移工具以只读方式打开原数据库，通过 SQLite VACUUM INTO 创建一致副本，检查 integrity_check、外键和关键表记录数，确认源数据库在复制期间未变化后再切换位置。目标已存在时拒绝覆盖。原数据库保留为备份，位置配置通过独立 storage.json 保存。

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example migrate_archive -- '<应用数据目录>' 'D:/MineChronicleData/minechronicle.sqlite3'
```

应先退出应用。新位置不可用时启动报错，不会静默退回旧盘建立空库。迁移不改写任何 Minecraft 文件。

## 验证范围

Rust 测试覆盖旧 schema 迁移、档案迁移和保留别名、拒绝覆盖、不可用磁盘、PCL 新旧隔离规则、全局设置、共享根目录去重、缓存补齐加载器、无效配置与范围边界。前端测试覆盖秒数、大整数和警告分组。自动测试使用合成文件与临时数据库。

另在本地 Edge/Playwright 的 1080 和 600 像素窗口验证重复原因只显示一次、路径折叠、18 秒读数、PCL 实例展示及玩家名称交互。浏览器界面验证使用模拟 IPC；真实 SQLite 与注册命令另由 Rust 集成测试覆盖。

本阶段后续为 Phase 5：HMCL / Prism Adapter；文件监控、增量追踪和回档处理仍在 Phase 7。
