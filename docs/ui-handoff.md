# UI 收尾交接

> 写给下一个接手的人（或压缩上下文后的我自己）。**只记录当前状态和待办，不重复历史。**

## 仓库

`D:\MineChronicle`，分支 `feature/runtime-stat-icons`，工作区干净。

**已安装 0.10.26** —— 但它**不含**下面"本轮已完成"里的 6 项，需要重新打包才能看到。

> ## ⚠️ 内容列宽度变了（所有绝对测量值作废）
>
> **2026-09-23 侧边栏改造之后，2048 窗口下内容列从 `1624px` 变成 `1380px`**，因为
> 左侧多了 220px 的导航栏 + 24px 间距。1280 窗口下是 `1224 → 980`。
>
> `docs/ui-redesign-brief.md` §4 里所有按 1440 宽度记录的绝对数值（页高、卡片数、
> 侧栏宽度）以及 §4.A 的页面高度表**都成了旧世界的数据**。**重新测量，不要对照旧表。**
> 页面高度本身也变了：`#/settings` 在 2048 下 `1893 → 1793`，620 下 `3000 → 2958`。
>
> 想知道当前值，跑 `node scripts/qa-chrome-measure.mjs after`。

## 侧边栏断点（改 `.app-shell` 之前先读）

导航栏是 `styles/shell.css` 里的一个网格列，三档：

| 宽度        | 形态                                                             |
| ----------- | ---------------------------------------------------------------- |
| **>1100px** | 220px 带文字的侧边栏（品牌在顶、7 项导航、两个驻留标签在底）     |
| **≤1100px** | `--sidebar-w-compact` 72px 图标栏；文字标签隐藏，靠 `title`      |
| **≤860px**  | 侧边栏整个让位，同一份 DOM 回流成顶部横条（`display: contents`） |
| **≤620px**  | 顶部横条再收：去掉"托盘驻留"、品牌方块降到 30px                  |

**≤860px 起主导航不再吸顶**，只有设置页的分区导航吸顶。原因：横条在 620 下会折成两行
（高 85px），分区导航的 `top` 没法用一个常数同时避开一行和两行——实测两者重叠 38px。

版本必须五处一致，否则设置页启动即抛错（`runtime_info` 会交叉校验）：
`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src/lib/version.ts`、`src-tauri/Cargo.lock`。

## 本轮已完成（7 项，全部验证通过）

| 提交         | 内容                      | 实测                                                       |
| ------------ | ------------------------- | ---------------------------------------------------------- |
| `4fa0a12`    | 顶部栏重叠                | 145% 缩放下导航压进顶栏 5px、分区栏压进导航 15px → **0px** |
| `215857e`    | 导入胶囊改绿              | 中性灰 → success 绿                                        |
| `59d9880`    | 统计图标 + 分组排序       | 28→40px（行高 53px）；父组按时长降序，+3 测试              |
| `a9753d4`    | 排行上方留白 + 药丸内边距 | 24→12px；文字两侧 12→21px                                  |
| 见下一次提交 | 顶部横栏改左侧边栏        | 顶部 chrome **149→0px**；`pageContentTop` 139→16px @2048   |

**踩过的坑，别再踩**：

- 吸顶偏移曾是硬编码算术（`--chrome-header + --control-sm + --space-3`）。改药丸高度时必须同步改它。现在两个高度都从真实值推导：`--chrome-header` / `--chrome-nav`。
- **外边距会折叠** —— 只改 `.ranking-switch` 的 `margin-top` 毫无效果，要连上面的 `margin-bottom` 一起改。
- 卡片样式**声明了两份**（`warmth.css` + `styles.css`），且 `:is()` 取参数里最具体者的优先级。改一处不生效时先查另一处。
- CSS 在 dev 下全部注入为 `<style>`，`document.styleSheets` 里 `href` 为 null —— 所以按"inline"过滤找规则时不要以为它不在源码里。
- **网格子项上的 `margin: auto` 会改掉它的宽度。** `main` 带着 `margin: 16px auto 24px`
  （块级布局时代为了在宽度上限里居中）。块级盒子上 auto 什么也不做；**网格子项上它会
  让元素不再拉伸填满网格区，而是按 `fit-content` 定宽，而 `fit-content` 的下限是
  min-content**。实测：620 窗口下打开观测页的 `<details>` 后，内容 min-content 是 643px
  而网格列只有 584px → 文档横向溢出 41px。`grid-template-columns` 是对的、元素拒绝适配它，
  这种症状很难从轨道尺寸看出来。解法见 `styles/shell.css` 的 `.main-column { margin-inline: 0 }`。
- **一条跨越多个网格行的子项会把富余高度摊到那几行上。** 把品牌 / 导航 / 页脚标签写成
  `.app-shell` 的三个网格行、再让内容列跨这三行，实测
  `grid-template-rows: 501.8px 709.8px 517.8px` —— 导航被推到 y=502，标签掉到 y=1212。
  `max-content` 行**治不了**：摊派恰恰发生在子项尺寸超过行总和的时候。只能把它们收成**一个**
  网格子项（`.app-rail`）。
- **不要用 `git worktree` + `node_modules` 目录联接（junction）来跑旧提交做对照。**
  `git worktree add` 之后建 junction 指向真 `node_modules`，`git worktree remove` 会
  **穿过 junction 删真目录**（报错是 `Invalid argument`，看起来像没删成，其实 `node_modules/.bin`
  和部分包已经没了）。要恢复：`npm rebuild` 重建 `.bin`，再 `npm install` 补回缺失的包
  （`npm install --offline` 不够，缓存不全）。更稳的做法：复制一份仓库，或者只 diff CSS。

## 待办（3 项）

### 1. 实例行加"伪服务器时长"（`#7`）

用户原话：**"加到实例行上并说明加的这部分是'伪服务器时长'"**。

已定位的数据路径：

- `TrackingSummary.sessions[].pseudo_seconds` —— 每个会话一段"无世界进度"的时长
- `TrackingSummary.pseudo[]` —— **按实例的聚合**，字段含 `seconds` / `week_seconds` / `month_seconds` / `sessions` / `unknown_sessions` / `baseline_sessions`
- `lib/tracking.ts` 的 `pseudoTotals()` 把 `pseudo[]` 求和（Dashboard 在用）

**下一步**：读 `TrackingSummary.pseudo[]` 的完整类型（确认哪个字段标识实例 —— 大概是 `instance_path`，需核实），然后在 `src/components/PclInstances.tsx` 的 `.instance-row` 里加一行，**文案必须说明这是伪服务器时长**，不能让它看起来像真实游玩时长。

`PclInstances` 目前**不接收** `tracking`，需要从上层传下来（看 `src/app/ArchivePages.tsx` 怎么组装 props）。

### 2. 统计页工具行对齐 —— **未解决，但线索很具体**

用户截图显示"玩家选择与其他页面同步；其他筛选仅影响本页。"比右侧控件低约 **10px**。

逐层实测（`.filter-summary`，宽 1624、高 **51px**、`display:flex`、`align-items:center`）：

```
textTop=18  <span>                       "玩家选择与其他页面同步…"
textTop=10  <button>                     "紧凑"
textTop=10  <button>                     "舒适"
textTop= 7  <label class=setting-switch>  "显示技术字段"
textTop=17  <button class=text-button>    "清除本页筛选"
```

**11px 跨度，症状是真的。**

对齐链（`getComputedStyle`）：

```
<button>                   display=block  h=38px  top=475
<div class=health-tabs>    display=flex   align-items=normal   h=51px  top=475
<div class=filter-tools>   display=flex   align-items=center   h=51px  top=475
<div class=filter-summary> display=flex   align-items=center   h=51px  top=475
```

**矛盾点（关键线索）**：`.health-tabs` 是 **51px 的 flex 容器**，里面是 **38px 的按钮**。我给它加了 `align-items: center`，并且**用 `getComputedStyle` 确认规则真的生效了**（返回 `center`）—— **但按钮的 top 仍等于容器顶部，文字位置一个像素都没动。**

51px 的 `align-items: center` 容器里，38px 的子元素不可能停在 0。**所以某个测量量的不是我以为的元素。** 下一步：

1. 用 DevTools 的 Elements 面板直接看那个按钮的盒子，而不是 `getBoundingClientRect()`
2. **查 `.health-tabs` 有没有 `padding`** —— 若 padding-top 是 6.5px，内容盒顶部就在 6.5，按钮在内容盒顶部，那"按钮 top = 容器 top"就是 padding 造成的错觉
3. 查按钮除 `height` 外的因素：`line-height`、`vertical-align`、`margin`

**别再从 `align-items` 入手** —— 那条路走过三次，都没用。

**另外**：改完 CSS **不要立刻测量**。Vite HMR 要几秒；我因此误判过一次"修复无效"并撤回了本来是正确方向的改动。**等 5 秒以上**。

### 3. 设置页"气泡"对齐（`#2`）

用户原话：**"'PCL 自动联动'和设置页其他气泡都没对齐，很别扭和突兀"**。

**"气泡"指什么还没确认** —— 可能是卡片标题，也可能是右上角的状态标签（如「PCL 已关闭 · 配置可用」）。设置页现在是 `columns: 2 640px` 两列，我量到两列的左边缘是对齐的。

**先问清楚，别猜。**

## 验证协议

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm run verify                    # 期望 exit 0，148 前端 / 224 Rust

# 需要 npm run dev 跑在 1420
node scripts/qa-observation-flow.mjs
node scripts/qa-reliability-flow.mjs
node scripts/qa-review-fixes.mjs
node scripts/qa-player-persistence.mjs
node scripts/qa-instance-pagination-width.mjs
node scripts/qa-design-check.mjs  # 7 路由 × 2 主题，对比度/字号/外部请求
node scripts/qa-chrome-measure.mjs after   # 顶部 chrome 高度 + 三档断点截图
```

**`qa-chrome-measure.mjs` 的 before/after 用法**：`QA_BASE=http://127.0.0.1:1421` 可以让它
指到另一个（旧提交的）服务器上，这样 before/after 两轮用的是同一把尺子，不会各量各的。

**用户窗口约 2048 逻辑像素宽**（截图是 1.24× 缩放）。**所有测量都要在这个宽度下做** —— 我之前一直用 1440，正好卡在内容上限，漏掉了真实的宽度问题。

**快照**：改完 CSS 后的**第一轮** `qa-visual-snapshot` 可能捕获到 Vite HMR 中途状态，重跑即可。

## 打包

```powershell
# 五处版本号一起改，然后
$env:CARGO_BUILD_JOBS='1'
npm run desktop:package            # 约 7 分钟
# 安装包在 src-tauri\target\release\bundle\nsis\
# 静默安装 /S，然后启动 C:\Users\ASUS\AppData\Local\MineChronicle\minechronicle.exe
# 核对 %APPDATA%\dev.minechronicle.desktop\last-startup.json 里的 version
```
