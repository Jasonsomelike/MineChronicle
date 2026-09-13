---
feature: runtime-stat-icons
status: delivered
updated: 2026-09-09
branch: feature/runtime-stat-icons
commits: b9d8a4c..HEAD
---

# 运行时统计图标自动补齐

## Report

**What was built** — 运行时图标补齐：动画首帧、block 兜底、实体优选、blake3 磁盘缓存与 `store_stat_icon`。打开统计页只自动应用 **cache-only** 结果；完整本机扫描仅由「检查本页游戏图标」触发。手动检查后展示汇总摘要与可折叠明细（缓存/材质/已渲染/未找到/错误 + 来源/原因）。GSAP 负责新图标入场。

**Verification** — cargo lib runtime/cache_only 测试与 clippy 通过；npm typecheck/lint/test（77）通过；独立审查无 critical；已修 rendered 分类、签名 memo、冗余遍历、明细 chips。

**Journey log** —
- AppHandle 在 generic configure 下不可作 CommandArg → IconCacheDir。
- 动画首帧由前端 canvas 裁剪，无 image crate。
- cache_only 需与完整模式同一 signature，因此仍做文件元数据 walk，但不打开 jar；按 root memo。
- 渲染成功后 `delete job`，明细用 renderedIds 而非 job 字段判「已渲染」。
- 用户要求缓存可自动、扫描必须手动 + 页内明细。

## [S1] Problem

MineChronicle「更多统计」的图标目录是按开发档案预生成的。软件移植到其他用户后，对方安装的模组/资源包不同，大量统计行只能显示中性占位。运行时补齐若自动扫描会让用户不知情；结果若无明细则无法核对来源与失败原因。

## [S2] Design

### 目标行为

1. **磁盘缓存自动**：打开统计页对缺图行做 cache-only 查询，命中则显示，不打开 mods/jar。
2. **本机扫描必须手动**：仅用户点击「检查本页游戏图标」才完整解析。
3. **操作明细**：手动检查后页内可折叠明细 + 汇总 chips。
4. 不执行 Java 代码，不改 Minecraft/PCL 文件。

### 解析契约（Rust）

- 动画 `.mcmeta` → `kind: "frame"` job；`models/block` 兜底；实体优先 `geo/entity/`。
- 缓存键 `blake3(root+\0+signature+\0+category+\0+key)`；`{app_data}/stat-icon-cache`。
- `resolve_stat_icons(args: { requests, cacheOnly })`；cacheOnly 只读缓存（signature 按 root memo，不打开归档）。
- `store_stat_icon` 校验后写缓存。

### 前端契约

- 自动：`discoverIcons(..., { cacheOnly: true })`；按钮：`refreshKnown` + 完整模式。
- 明细 `{ id, label, status: cached|resolved|rendered|missing|error, source, reason }`。
- UI：状态摘要行 + 「展开明细」+ chips + 表格。
- GSAP 入场；reduced-motion 跳过。

## [S3] Out of Scope

- 离线流水线 / javap / 专用 adapter。
- 启动全库后台渲染。
- 改内嵌目录生成。
- HMCL/Prism、缓存入 SQLite 迁移。

## Tasks

- [x] T1: Rust 扩展解析 (covers: S2)
- [x] T2: Rust 持久缓存与 store (covers: S2; depends: T1)
- [x] T3: 前端 frame/回写/GSAP (covers: S2; depends: T2)
- [x] T4: 全量验证 (covers: S2; depends: T1–T3)
- [x] T5: GSAP 实测 (covers: S2; depends: T3)
- [x] T6: Rust cache_only (covers: S2; depends: T2)
- [x] T7: 前端手动扫描与明细 UI (covers: S2; depends: T6)
- [x] T8: 重建桌面版 (covers: S2; depends: T7)
- [x] T9: legacy 实体键、纹理别名与纹理兜底 — acceptance: 单测覆盖 PoisonSpider/chaos_guardian/apostle 路径 (covers: S2)