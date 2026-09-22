---
feature: ui-refactor
status: delivered
updated: 2026-09-22
branch: feature/runtime-stat-icons
commits: 366f90a..working-tree
---

# UI 架构与体验闭环

## Report

**What was built** — 在保留石墨-翡翠视觉语言的前提下完成 UI 架构拆分与体验闭环。`ScanPanel`（约 975 行）拆为 `app/routes.ts`、`app/useAppState.ts`、`app/AppShell.tsx`、`app/ArchivePages.tsx`；样式迁到 `styles/{tokens,shell,pages}.css`。壳层 header/nav/status 压缩并 sticky 导航。UX：计数口径区分「所选 vs 档案」、世界库默认平铺可切换分组、统计技术字段折叠 + 紧凑/舒适密度、时间线日期快捷 + UUID 可复制、状态区分配置同步与统计保存、缩放说明指向真实控件。UI 原子见 `components/ui`。

**Verification** — `npm run typecheck` PASS · `npm run lint` PASS · `npm test` 130/130 PASS（含 `routes.test.ts`）· `npm run format:check` PASS。独立审查 3 critical（设置误显、密度开关缺失、UUID 复制缺失）已修，复审 FIXED，无新 critical。Rust 测试未跑（本轮纯前端）。

**Journey log** —

- 主机策略禁止 `git worktree add`，沿用当前工作区 `feature/runtime-stat-icons`，不嵌套 worktree。
- ScanPanel 抽取时曾丢掉 `settings-layout` 的 `hidden` 守卫，导致设置卡片在所有页可见；抽取时要对照原 JSX 的显示条件。
- 任务勾选不能只看标题：S2.4 正文还要求密度开关与 UUID 复制，审查补上。
- 平铺世界行的展开状态必须受控（`open`/`onOpenChange`），否则「全部展开」按钮无效。

## [S1] Problem

MineChronicle 是数据密集的本地生涯统计桌面应用。近期已完成设计 token 收敛（七级字阶、三级控件、4px 间距、圆角/海拔/动效命名刻度、石墨-翡翠色板、暗色主题、数字等宽），但两类债务仍阻碍体验与后续迭代：

1. **架构**：`src/components/ScanPanel.tsx`（约 975 行）同时承担 hash 路由、PCL/追踪状态轮询、玩家选择持久化、设置页布局、导入表单、以及七页内容挂载；`src/styles.css` 约 3265 行 + `warmth.css` 约 732 行，页面与组件样式按历史堆叠而非分层。改任一页面都容易牵动壳层。
2. **体验**：`docs/ui-audit-2026-09-08/report.md` 中 P1/P2 问题多数未闭环——150% 缩放下导航/状态/筛选挤占首屏；世界/实例/统计计数口径不一致；世界列表默认技术分组不利于找世界；统计行技术字段过重；时间线单条纵向过高；设置文案与控件位置不符；追踪状态缺少业务语义。

目标：在**保留石墨-翡翠视觉语言**的前提下，拆开壳层与页面边界，闭环审计中的密度/导航/列表/状态问题，使 UI 可安全演进。

## [S2] Design

### 决策摘要

| 维度     | 决策                                                |
| -------- | --------------------------------------------------- |
| 视觉     | 保留 cool graphite + jade console；不重做色板/字阶  |
| 范围     | 组件/样式架构拆分 + UX 闭环（用户已确认）           |
| 信息架构 | 保留 7 页导航；压缩壳层垂直占用；页内增强           |
| 技术     | 不引入路由库/组件库；继续 React 19 + 手写 CSS token |
| 交付     | 分 4 个可独立验收批次，每批 `npm run verify`        |

### [S2.1] 目标架构

```text
src/
  app/
    AppShell.tsx          # 页头、主导航、状态条、页脚、连接检查
    routes.ts             # 页面 id、标签、图标映射；hash 解析/写入
    useAppState.ts        # 共享：view、players/scope、tracking、pcl、backgroundErrors
  components/
    pages/                # Dashboard / Instances / Worlds / Timeline / Statistics / Observation / Settings
    settings/             # 从 ScanPanel 抽出的设置分区
    ui/                   # Button、Field、Card、Tabs、Pagination 等原子
  styles/
    tokens.css            # 现 :root 刻度（自 styles.css 顶部迁出）
    base.css              # preflight 覆盖与元素基线
    shell.css             # app-header / app-nav / status-center / footer
    pages/*.css           # 按页拆分现有巨型规则
    components/*.css      # 原子组件
  warmth.css              # 主题 token（角色命名）— 保留
  motion.css              # 动效刻度 — 保留
```

**Shell 契约**

- `AppShell` 只负责 chrome：品牌栏、`app-nav`、`status-center`、设置分区锚点导航、页脚。
- 页面组件接收明确 props（`report`、`scope`、回调），不在壳内内联页面 JSX。
- `SessionPage` 保留「非激活不挂载重查询」语义；路由切换仍写 `location.hash`，深链行为不变。
- 共享状态：`useAppState`（或等价 context）持有 `view` / `scope` / `trackingStatus` / `pclStatus` / `backgroundErrors` / `report`；`savePlayers` 仍经统一入口持久化。

**样式分层规则**

- Token 只在 `tokens.css` / `warmth.css` / `motion.css`。
- 布局 chrome 只在 `shell.css`；页内规则不得写死 chrome 尺寸。
- 组件原子优先复用 `--control-*` / `--type-*` / `--space-*` / `--radius-*`；禁止新魔法像素（新增步骤须写进 token 注释）。
- `.scan-panel` 作为历史作用域可在迁移期保留，迁移完成后收窄为页面根 class。

### [S2.2] 壳层与导航密度（闭合审计 P1-2）

- `app-header`：品牌与工具行合并为**单行紧凑栏**（目标高度 ≤ 48px @100%）；`sticky` 保持。
- `app-nav`：仍为 7 项；窄有效视口（含 150% 缩放）下 icon + 短标签，必要时允许横向滚动或两行但总 chrome（header+nav+status）≤ 160px @150%。
- `status-center`：收成**单行状态摘要**，详情进 disclosure；不与导航争高。
- 设置页 `settings-jump` 保持 sticky，但计入 chrome 预算；长页提供「回到顶部」或当前节标题可见。
- 滚动时主导航保持可达（可改为 header 内 sticky 联动，而非仅品牌 sticky、导航滚走）。

**验收**：100% 与 150% 下，概览首屏能看到累计时长 + 排行入口；统计首屏能看到至少一组筛选摘要 + 表头或首行；键盘可聚焦全部导航项。

### [S2.3] 计数口径（闭合审计 P1-3）

统一文案模式：`范围限定 + 数字 + 单位 + 可选去向`。

| 位置   | 现状                            | 目标                                        |
| ------ | ------------------------------- | ------------------------------------------- |
| 概览   | 「92 个世界 · 63 个 PCL 实例」  | 「所选玩家涉及 92 个世界 · 63 个 PCL 实例」 |
| 世界页 | 「49 个实例根目录 · 97 个世界」 | 「档案共 97 个世界 · 49 个有世界的目录」    |
| 统计页 | 「92 份有效玩家统计」           | 「所选玩家 92 份有效统计」                  |

数字旁提供短 tooltip/说明：为何与档案总量不一致（筛选 vs 全量、实例 vs 根目录）。**不改变统计计算**，只改呈现与解释。

### [S2.4] 列表效率（闭合审计 P2-4/5/6）

**世界库**

- 默认视图：**平铺世界行**（名称、所属实例、时长、最近活动、状态）；提供「按实例分组」切换。
- 搜索与筛选保留；「全部收起」在默认折叠态改为「全部展开」或禁用。
- 玩家列表作为行内/侧栏附属，不再把技术分组当首屏主体。

**统计表**

- 默认行：图标 + 名称 + 读数 + 来源摘要；分类、原始键进 `<details>` 或「显示技术字段」。
- 提供「紧凑 / 舒适」密度开关（默认紧凑）；原始键始终可展开，不删除排错数据。
- 「检查本页游戏图标」降为次级操作，靠近资源状态徽章；文案明确「检查本页游戏图标」。

**时间线**

- 每条事件两行：`时间 · 世界 · 事件` / `玩家 · 增量`；UUID 进详情 + 复制。
- 日期快捷：今天 / 近 7 天 / 本月 / 清除；保留「观察时间 ≠ 实际会话」说明。

### [S2.5] 状态与设置文案（闭合审计 P2-7/8/9）

- 全局状态摘要使用业务语言：「等待游戏启动」/「正在追踪 N 个实例」/「正在同步存档」/「追踪已暂停」/「游戏已退出，正在收尾同步」（已有雏形，统一到壳层单一来源，避免观测页重复状态机）。
- 区分「配置最近同步」（PCL）与「统计最近保存」（档案）。
- 设置说明与控件位置一致：「缩放」说明指向本卡控件，不再写「窗口右上角」。

### [S2.6] 质量约束（skill overlay）

来自 threejs-game-skills UI 可迁移启发式（**非**游戏 HUD 规则）：

- 信息层级：状态 → 主内容 → 次要操作；避免通用 stat-card 堆叠（概览已用 playtime ruler，保持）。
- 数值容器稳定：时长/计数继续 `--font-mono`，防宽度跳动。
- 交互控件具备 hover / focus-visible / disabled；触控目标不适用（桌面）但点击热区 ≥ 28px（`--control-sm`）。
- 文案不解释本可做成 affordance 的控件；长文案/长路径不裁切（`displayPath` 行为保留）。
- `prefers-reduced-motion` / 系统减少动态效果继续关闭非必要动画（`motion.css`）。

**与 threejs-game-skills 冲突裁决**：本产品是桌面数据工具，不是 Three.js 游戏。流程与游戏管线不适用；仅采纳上列 UI 启发式。compose-next 管流程，本文件管产品设计。

### [S2.7] 验证边界

- 每批：`npm run verify`（typecheck、lint、vitest、format、rustfmt、clippy、rust test）。
- UI 可观察行为：优先补 vitest（路由、计数文案纯函数、筛选摘要）与现有 `scripts/qa-*.mjs` / `visual-qa-*.mjs` 适用子集。
- 手动清单：100%/150% 缩放、浅色/深色、空档案 onboarding、有档案七页走查、键盘导航、长路径/长玩家名。
- 不要求重跑与 UI 无关的重型 Rust 扫描基准；若动到 IPC 文案/类型再跑对应 contract 测试。

## [S3] Out of Scope

- 色板/字阶/圆角/暗色体系重做；Minecraft 像素风或游戏 HUD 风格。
- 引入 React Router、组件库、CSS-in-JS、Tailwind 工具类回归。
- 改变统计口径算法、扫描/追踪/数据库行为、PCL 协议。
- HMCL/Prism、移动端触控、多窗口。
- threejs / WebGL / 3D 资产管线。
- 可访问性全量认证（读屏端到端、200% 缩放全矩阵）——本批只修已知缺陷与键盘可达。

## Tasks

- [x] T1: 建立 `feature/ui-refactor` worktree 与工作区 — acceptance: linked worktree 干净可构建 (covers: S2)
      **覆盖**：主机策略禁止 `git worktree add`；沿用当前工作区 `feature/runtime-stat-icons` @ `366f90a`。
- [x] T2: 抽出 `app/routes.ts` + `AppShell` + `useAppState`，ScanPanel 删除 — acceptance: 七页 hash 深链行为不变，共享玩家选择仍持久化 (covers: S2.1)
- [x] T3: 样式迁至 `styles/` 分层（tokens/shell/pages）— acceptance: token 仅 tokens/warmth/motion；壳层规则独立 (covers: S2.1)
- [x] T4: 壳层密度：紧凑 header/nav/status，sticky 导航可达 (covers: S2.2; depends: T2)
- [x] T5: 计数口径统一文案与说明 — acceptance: 概览/世界/统计区分「所选 vs 档案」 (covers: S2.3; depends: T2)
- [x] T6: 世界库默认平铺 + 分组切换 — acceptance: 默认世界列表，可切换按实例分组 (covers: S2.4; depends: T2)
- [x] T7: 统计行密度与技术字段折叠 + 图标检查次级化 + 紧凑/舒适密度开关 (covers: S2.4; depends: T2)
- [x] T8: 时间线日期快捷（今天/近 7 天/本月/清除）+ 行距压缩 + UUID 详情可复制 (covers: S2.4; depends: T2)
- [x] T9: 状态摘要业务语言 + 配置同步/统计保存分列 + 缩放说明纠偏 (covers: S2.5; depends: T2)
- [x] T10: UI 原子（SecondaryButton/TextButton/Card/Tabs/Pagination）— acceptance: WorldLibrary 使用原子 (covers: S2.1; depends: T3)
- [x] T11: 集成验证 + 独立审查（3 critical 已修：设置误显、密度开关、UUID 复制）— acceptance: typecheck/lint/130 tests/prettier 通过 (covers: S2.2–S2.7; depends: T4–T9)
