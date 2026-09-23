# UI 收尾交接

> 写给下一个接手的人（或压缩上下文后的我自己）。**只记录当前状态和待办，不重复历史。**

## 仓库

`D:\MineChronicle`，分支 `feature/runtime-stat-icons`，工作区干净。

**已安装 0.10.26** —— 但它**不含**下面"本轮已完成"里的 6 项，需要重新打包才能看到。

版本必须五处一致，否则设置页启动即抛错（`runtime_info` 会交叉校验）：
`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src/lib/version.ts`、`src-tauri/Cargo.lock`。

## 本轮已完成（6 项，全部验证通过）

| 提交      | 内容                      | 实测                                                       |
| --------- | ------------------------- | ---------------------------------------------------------- |
| `4fa0a12` | 顶部栏重叠                | 145% 缩放下导航压进顶栏 5px、分区栏压进导航 15px → **0px** |
| `215857e` | 导入胶囊改绿              | 中性灰 → success 绿                                        |
| `59d9880` | 统计图标 + 分组排序       | 28→40px（行高 53px）；父组按时长降序，+3 测试              |
| `a9753d4` | 排行上方留白 + 药丸内边距 | 24→12px；文字两侧 12→21px                                  |

**踩过的坑，别再踩**：

- 吸顶偏移曾是硬编码算术（`--chrome-header + --control-sm + --space-3`）。改药丸高度时必须同步改它。现在两个高度都从真实值推导：`--chrome-header` / `--chrome-nav`。
- **外边距会折叠** —— 只改 `.ranking-switch` 的 `margin-top` 毫无效果，要连上面的 `margin-bottom` 一起改。
- 卡片样式**声明了两份**（`warmth.css` + `styles.css`），且 `:is()` 取参数里最具体者的优先级。改一处不生效时先查另一处。
- CSS 在 dev 下全部注入为 `<style>`，`document.styleSheets` 里 `href` 为 null —— 所以按"inline"过滤找规则时不要以为它不在源码里。

## 待办（3 项）

### 1. 实例行加"伪服务器时长"（`#7`）

用户原话：**"加到实例行上并说明加的这部分是'伪服务器时长'"**。

已定位的数据路径：

- `TrackingSummary.sessions[].pseudo_seconds` —— 每个会话一段"无世界进度"的时长
- `TrackingSummary.pseudo[]` —— **按实例的聚合**，字段含 `seconds` / `week_seconds` / `month_seconds` / `sessions` / `unknown_sessions` / `baseline_sessions`
- `lib/tracking.ts` 的 `pseudoTotals()` 把 `pseudo[]` 求和（Dashboard 在用）

**下一步**：读 `TrackingSummary.pseudo[]` 的完整类型（确认哪个字段标识实例 —— 大概是 `instance_path`，需核实），然后在 `src/components/PclInstances.tsx` 的 `.instance-row` 里加一行，**文案必须说明这是伪服务器时长**，不能让它看起来像真实游玩时长。

`PclInstances` 目前**不接收** `tracking`，需要从上层传下来（看 `src/app/ArchivePages.tsx` 怎么组装 props）。

### 2. 统计页工具行对齐 —— **真因未找到**

用户截图显示"玩家选择与其他页面同步；其他筛选仅影响本页。"比右侧控件低约 **10px**。

但我实测 `.filter-summary`（`display:flex; align-items:center`，高 51px）里：

- 说明文字 textTop = **+18**
- 右侧控件容器 boxTop = 0、高 51

**两个数对不上 —— 说明我量的不是用户看的那个元素。** 下一步应该逐层量右侧控件**内部**的文字位置，而不是它容器的盒子。

### 3. 设置页"气泡"对齐（`#2`）

用户原话：**"'PCL 自动联动'和设置页其他气泡都没对齐，很别扭和突兀"**。

**"气泡"指什么还没确认** —— 可能是卡片标题，也可能是右上角的状态标签（如「PCL 已关闭 · 配置可用」）。设置页现在是 `columns: 2 640px` 两列，我量到两列的左边缘是对齐的。

**先问清楚，别猜。**

## 验证协议

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm run verify                    # 期望 exit 0，139 前端 / 223 Rust

# 需要 npm run dev 跑在 1420
node scripts/qa-observation-flow.mjs
node scripts/qa-reliability-flow.mjs
node scripts/qa-review-fixes.mjs
node scripts/qa-player-persistence.mjs
node scripts/qa-design-check.mjs  # 7 路由 × 2 主题，对比度/字号/外部请求
```

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
