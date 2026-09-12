---
feature: runtime-stat-icons
status: in-progress
updated: 2026-09-08
branch: feature/runtime-stat-icons
commits: 
---

# 运行时统计图标自动补齐

## Report

## [S1] Problem

MineChronicle「更多统计」的图标目录是按开发档案预生成的。软件移植到其他用户后，对方安装的模组/资源包不同，大量统计行只能显示中性占位。已有 `resolve_stat_icons` 能做部分本地发现，但仍缺动画材质首帧、方块模型兜底、更稳健的实体几何配对，且前端成功渲染的 PNG 不会持久化，每次会话都要重扫重渲。

## [S2] Design

### 目标行为

1. 打开「更多统计」或点击「检查实例资源」时，对当前页缺图行懒加载解析；优先读磁盘缓存，未命中再扫实例。
2. 运行时扩展：动画材质首帧、`models/block` 兜底、更稳健的 Bedrock 实体几何/皮肤配对。
3. 前端 WebGL（three.js）渲染成功后，将 PNG 写回应用数据目录缓存；下次同根签名直接返回。
4. 不执行 Java 代码，不改 Minecraft/PCL 文件，不做完整离线流水线（javap、GT/Draconic 专用适配器）。

### 解析契约（Rust `runtime_resources`）

- **动画材质**：存在 `{texture}.png.mcmeta` 时，解析 `animation.frame_height`（缺省为宽度切方格），生成前端 job：
  `{ kind: "frame", layers: [dataURL], frameHeight, cacheKey, root }`。
  不再因动画直接 missing。
- **方块模型兜底**：`models/item/{name}.json` 不存在时，尝试 `models/block/{name}.json`；父链、元素、材质解析复用现有逻辑。
- **实体**（`killed` / `killed_by`）：
  - 多个 `*.geo.json` 时优先 `geo/entity/` 路径，其次路径含实体名且无 `overlay`/`layer` 的文件；
  - 皮肤优先 `textures/entity/**/{name}.png`，再回退唯一非 overlay 候选；
  - 仍要求几何可唯一解释且复杂度未超限；无法唯一配对则 missing 并保留原因。
- **缓存键**：`blake3(root_path + "\0" + index.signature + "\0" + category + "\0" + key)` 的十六进制。签名变化（装删模组/资源包）自动失效。
- **缓存位置**：`{app_data}/stat-icon-cache/{cache_key}.png` 与同名 `.json` 元数据（source/reason/width/height/kind）。不写游戏目录。
- **`resolve_stat_icons`**：
  1. 校验请求上限（保持现有 100 条 / root 限制）；
  2. 对每条请求算 cacheKey；若 PNG+JSON 存在且 PNG 签名为 PNG，返回 `image: data:image/png;base64,...`，`reason` 标明来自缓存；
  3. 否则按现有路径解析；需要前端渲染的结果带上 `cacheKey` 与 `root`；可直接返回的材质图由 Rust 写入缓存。
- **`store_stat_icon`**（新命令）：
  - 入参：`cache_key`（64 位十六进制）、`png`（base64 或 data URL，≤2MB）、`width`/`height`（1–2048）、`kind`、`source`、`reason`；
  - 校验 PNG 魔数与尺寸后写入缓存；覆盖写；
  - 返回 `ok: bool`。
- **`IconCacheDir`**：由 `configure` 注入默认状态，`setup` 写入 `{app_data}/stat-icon-cache`；命令用 `State` 读取，不依赖 `AppHandle` CommandArg。

### 前端契约

- `discoverIcons`：保持按需；处理 `kind: "frame"`（canvas 裁剪首帧）；渲染成功且有 `cacheKey` 时调用 `store_stat_icon`；失败不阻断展示。
- 打开统计页、数据加载完成且存在无内嵌图标的行时，自动发起一次 `discoverIcons`（不强制 refresh 已有图标）；「检查实例资源」按钮仍可强制刷新。
- 图标出现时使用轻微入场动画（`stat-icon-in`）；`prefers-reduced-motion` 下关闭。不引入 GSAP 新依赖：three.js 已负责模型离屏渲染，列表动效用 CSS 即可，保持离线包体与审计面更小。
- 展示优先级不变：本地缓存/发现结果优先于内嵌目录缺失占位。

### 错误与边界

- 缓存目录不可写：解析结果仍返回，不持久化；不弹阻断错误。
- 损坏缓存：视为未命中，可被覆盖。
- 空气键 `minecraft:air` 继续跳过自动发现。
- 请求含非绝对 root 时忽略该 root（现状保留）。

## [S3] Out of Scope

- 开发期 PowerShell/JDK 提取流水线、javap、模组专用 adapter 下沉运行时。
- 启动后全库后台批量渲染。
- 改动内嵌 `stat-resources.json` 目录生成逻辑。
- HMCL/Prism 适配。
- 将缓存并入 SQLite 档案迁移。
- 引入 GSAP 或其它新动画运行时。

## Tasks

- [ ] T1: Rust 扩展解析——动画首帧 job、block 模型兜底、实体几何/皮肤优选 — acceptance: 单元测试覆盖三类路径且通过 (covers: S2)
- [ ] T2: Rust 持久缓存——cacheKey、读缓存、`store_stat_icon` 命令与注册 — acceptance: 单元测试：写入后读缓存返回图，非法 key/PNG 拒绝 (covers: S2; depends: T1)
- [ ] T3: 前端 frame 裁剪、渲染回写缓存、统计页自动懒加载与图标入场动效 — acceptance: typecheck/lint/前端测试通过 (covers: S2; depends: T2)
- [ ] T4: 全量验证 — acceptance: cargo fmt/clippy/test 与 npm typecheck/lint/test 通过，失败项有记录 (covers: S2; depends: T1, T2, T3)
