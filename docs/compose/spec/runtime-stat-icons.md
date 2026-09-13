---
feature: runtime-stat-icons
status: in-progress
updated: 2026-09-09
branch: feature/runtime-stat-icons
commits: b9d8a4c..HEAD
---

# 运行时统计图标自动补齐

## Report

## [S1] Problem

MineChronicle「更多统计」的图标目录是按开发档案预生成的。软件移植到其他用户后，对方安装的模组/资源包不同，大量统计行只能显示中性占位。已有 `resolve_stat_icons` 能做部分本地发现，但仍缺动画材质首帧、方块模型兜底、更稳健的实体几何配对，且前端成功渲染的 PNG 不会持久化。

补充问题：打开统计页会**自动**从本机实例补齐缺图，用户无法事先知情或否决；操作结果只有一行摘要，看不到逐条来源与失败原因。

## [S2] Design

### 目标行为

1. **磁盘缓存自动**：打开统计页对缺图行做 cache-only 查询，命中则显示，不扫 mods。
2. **本机扫描必须手动**：仅用户点击「检查本页游戏图标」才完整解析（缓存→未命中再扫实例/渲染）。
3. **操作明细**：手动检查后页内展示可折叠明细（逐条统计键、结果类型、来源/原因），并有成功/缓存/失败汇总。
4. 运行时扩展与缓存契约（动画首帧、block 兜底、实体优选、blake3 缓存、`store_stat_icon`）保持已交付行为。
5. 不执行 Java 代码，不改 Minecraft/PCL 文件。

### 解析契约（Rust `runtime_resources`）

- **动画材质**：`.mcmeta` 存在时生成 `{ kind: "frame", layers, frameHeight, cacheKey, root }`。
- **方块模型兜底**：`models/item` 缺失时试 `models/block`。
- **实体**：优先 `geo/entity/`，皮肤唯一配对，否则 missing。
- **缓存键**：`blake3(root + \0 + signature + \0 + category + \0 + key)`。
- **缓存位置**：`{app_data}/stat-icon-cache/{cache_key}.png` + `.json`。
- **`resolve_stat_icons`**：
  1. 请求上限保持；
  2. 可选 `cache_only: bool`（默认 false）：true 时只读磁盘缓存，不索引实例、不生成 job；
  3. 命中返回 data URL；完整模式未命中再解析并附 `cacheKey`/`root`。
- **`store_stat_icon`**：校验后写缓存，返回 bool。
- **`IconCacheDir`**：managed state，`setup` 注入 app_data 路径。

### 前端契约

- `discoverIcons(rows, { refreshKnown?, cacheOnly? })`：
  - 自动路径：`cacheOnly: true`；
  - 按钮路径：完整检查（可 `refreshKnown`）；
  - frame 裁剪、渲染后 `store_stat_icon`。
- **明细模型**：`{ id, label, status: 'cached'|'resolved'|'rendered'|'missing'|'error', source, reason }`。
- **UI**：摘要 chip + 可折叠明细列表（默认收起）；移除打开页自动 full scan。
- GSAP 入场；`prefers-reduced-motion` 跳过。
- 优先级：内嵌目录 → 本机缓存/发现 → 占位。

### 错误与边界

- 缓存不可写：仍展示，不持久化。
- 损坏缓存：当未命中。
- `minecraft:air` 跳过。
- 非绝对 root 忽略。
- `cache_only` 未命中：missing，reason「缓存未命中，可手动检查」。

## [S3] Out of Scope

- 离线提取流水线 / javap / 专用 adapter 下沉。
- 启动后全库后台批量渲染。
- 改动内嵌目录生成逻辑。
- HMCL/Prism。
- 缓存并入 SQLite 迁移。

## Tasks

- [x] T1: Rust 扩展解析 — acceptance: 单测覆盖动画/block/实体 (covers: S2)
- [x] T2: Rust 持久缓存与 store 命令 — acceptance: 读写与非法拒绝单测 (covers: S2; depends: T1)
- [x] T3: 前端 frame/回写/懒加载/GSAP — acceptance: typecheck/lint/test (covers: S2; depends: T2)
- [x] T4: 全量验证 — acceptance: cargo/npm 检查通过 (covers: S2; depends: T1, T2, T3)
- [x] T5: GSAP 实测 — acceptance: 浏览器探针通过 (covers: S2; depends: T3)
- [ ] T6: Rust `cache_only` — acceptance: 单测证明 cache_only 未命中不产生 job (covers: S2; depends: T2)
- [ ] T7: 前端去自动扫描 + cache-only + 明细 UI — acceptance: 无自动 full discover；按钮后可折叠明细；typecheck/lint/test (covers: S2; depends: T6)
- [ ] T8: 重建桌面版 — acceptance: desktop:build 成功 (covers: S2; depends: T7)
