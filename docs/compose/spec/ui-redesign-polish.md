---
feature: ui-redesign-polish
status: designed
updated: 2026-09-23
branch: feature/runtime-stat-icons
commits: 027e0ae..working-tree # filled at delivery
---

# UI Redesign Polish

## Report

## [S1] Problem

`docs/ui-redesign-brief.md` 将本轮定位为 **Redesign — Preserve** 的定向演进：信息架构与 token 体系已成立，但仍有一批会伤害日常读数体验的残留：

1. 浅色模式下静息卡片仍穿阴影（brief §6），设置页 8 卡中约 6 张、dashboard 概览卡也在用 `--shadow-card`，阅读时像未完成的浮层而不是仪器面板。
2. dashboard hero（`career-total` + `PlaytimeRuler`）约 40% 死区，卡片读作半成品。
3. `#/instances` `#/worlds` `#/timeline` 在 1440×1000 下贴着视口高度，one-row 与 empty 视觉几乎无差（brief §6）。
4. §4 基线数字停在 2026-09-22，开工前必须重测并回写，否则验收对照失效。

硬约束（brief §2）全程有效：离线、Tailwind 仅 preflight、颜色只进 `warmth.css`、七级字阶、不写真实档案库、四套 Playwright 与 `npm run verify` 保持绿色。

## [S2] Design

### [S2.0] 范围与来源

- 真源：`docs/ui-redesign-brief.md`（约束、拨盘、token 契约、验证、pre-flight）。
- 模式：Preserve。现代化杠杆按 §5.C 顺序执行，本轮只做剩余项（杠杆 1 收尾、2、3 的阴影审计），不碰信息架构、路由、文案边界词、品牌色。
- 三拨盘维持 brief：`DESIGN_VARIANCE=4` / `MOTION_INTENSITY=3` / `VISUAL_DENSITY=7`。
- 不引入 Fluent / Tailwind 工具类 / 组件库。Figma 本轮不接入（无 MCP；brief 工作项均为代码与测量）。

### [S2.1] 浅色阴影契约（Step 2）

**规则**：静息卡片 = 边框 + 表面色，**无** elevation 阴影；阴影只留给真正叠在内容之上的层。

| 用途 | Token | 浅色 | 深色 | 处置 |
| --- | --- | --- | --- | --- |
| 静息卡片（`.settings-card`、dashboard 概览/排行卡） | 曾用 `--shadow-card` | 改为仅 `border` | 保持 `none` + 表面阶梯 | 去掉 elevation |
| 命令/弹出层 | `--shadow-pop` | 保留 | `none` | 覆盖层，保留 |
| 模态 | `--shadow-modal` | 保留 | `none` | 覆盖层，保留 |
| 导航高光 / 字段内嵌 / focus glow / cutout | `--shadow-nav/field/focus-glow/cutout` | 保留 | 保留 | 结构阴影 |

实现约束：

- 颜色角色仍在 `warmth.css`；组件文件禁止色值字面量。
- 深色覆盖只写在 `:root[data-theme='dark']`，禁止普通 `:root` 二次覆盖 elevation。
- 改完必须报告 shadowed-card 计数 before → after（Step 2 验收）。

### [S2.2] Hero 死区（Step 3）

`#/dashboard` 的 `career-total` 卡（headline + `PlaytimeRuler`）不得留大面积空白。

**决策**：优先 **提高 ruler 可见行数 / 让卡随内容收缩**，二选一或组合，以测量结果为准：

- 若排行数据行数固定且可加行而不拥挤 → 提高默认可见行，填满卡高。
- 若行数受数据限制 → 去掉撑开高度的样式，让卡贴内容高度；禁止用装饰填充。

验收：报告页面高度与 ruler 行数 before → after；ruler 轴刻度仍与下方排行一致（§9.5）。

### [S2.3] 短页 one-row / empty（Step 4）

对象路由：`#/instances`、`#/worlds`、`#/timeline`（基线 1000px = 视口高）。

**状态契约**（full state cycle，brief §8）：

| 状态 | 必须可区分 | 最低要求 |
| --- | --- | --- |
| empty | 与 one-row 不同 | 明确空态文案 + 引导动作（若有）；禁止“空壳列表框” |
| one-row | 与 empty、与多行列表不同 | 单行数据仍可读；容器高度贴内容或有最小仪器感，不拉成整页空白 |
| loading | 与 empty 不同 | 占位/`aria-busy`，不写“暂无” |
| error | 与 empty 不同 | 保留边界词：`结束时间未知`、`缺少本地基线`、`已缺失` |

交付物：each 状态一张截图（dev 预览 1440×1000，Playwright / 现有 qa 脚本能力）。

### [S2.4] 测量与验证契约（Step 0/5 + §9）

- Step 0 先重测 §4.A 表（7 路由高度/卡片/阴影/字阶），日期改为实测日，数字变动则改 brief。
- 每步收尾：`npm run verify` + 相关 Playwright + 设计测量陈述。
- §9.4 `scripts/qa-design-check.mjs`：14 组合 0 off-scale / 0 below-floor / 0 below-AA / 0 出站请求。
- §9.5 ruler：宽度与刻度一致；行是 `<button>` 且 Tab 可达；`reducedMotion: 'reduce'` 下 `.ruler-fill` 的 `animation-name: none`。
- 若改 DOM 破坏断言：更新测试 **并明确记录**，禁止静默删除。
- 不写 `%APPDATA%\dev.minechronicle.desktop\minechronicle.sqlite3`。

### [S2.5] 提交流程

- brief 要求每步一 commit；系统规则为不自动 commit。**实现过程可按步骤暂存变更，统一在用户批准后 commit**；若用户在批准 spec 时授权“按步骤 commit”，则改为每步一 commit。
- 不改：`src/app/routes.ts` 路由 slug、主导航标签、表单字段名/顺序、wordmark、数据边界文案、任何改变数值语义的规则。

## [S3] Out of Scope

- 新路由、新页面、IA 重排、Fluent/组件库、Tailwind 工具类、营销式 hero/bento。
- 重做色板/字阶/动效层（已达标；`MOTION_INTENSITY=3` 不加动画）。
- 步骤 1（pages.css 字阶违规）已完成，不重做。
- 步骤 6 打包/版本 bump（brief 表 #6）：仅当用户明确要求发布安装包时执行。
- Figma 设计稿 / Code Connect。
- 任何写入真实 `minechronicle.sqlite3` 的操作。

## Tasks

- [ ] T1: 工作区与工具链确认 — acceptance: 当前 `feature/runtime-stat-icons` 可构建，`node_modules`/cargo 就绪 (covers: S2.0)
- [ ] T2: 重测 brief §4 并回写日期与数字 — acceptance: §4.A 带今日实测值；偏差已写入 brief (covers: S2.4)
- [ ] T3: 浅色静息卡片去阴影，仅覆盖层保留 — acceptance: 报告 shadowed-card before→after；`qa-design-check` 0 违规；暗色 elevation 仍为 none (covers: S2.1)
- [ ] T4: 收缩或填满 dashboard hero 死区 — acceptance: 报告页面高度与 ruler 行数 before→after；§9.5 ruler 仍通过 (covers: S2.2; depends: T3)
- [ ] T5: 三短页 one-row/empty（含 loading/error 对照）设计并截图 — acceptance: 每状态可区分；截图落在 `output/` (covers: S2.3; depends: T3)
- [ ] T6: 全量 §9.4 + §9.5 回归 — acceptance: 0 违规；若断言变更已在报告中列出 (covers: S2.4; depends: T3, T4, T5)
- [ ] T7: `npm run verify` + 四套 Playwright + 快照确定性 — acceptance: verify 退出 0；四套 PASS；快照 0 真实差异并报告噪声计数 (covers: S2.4; depends: T6)
- [ ] T8: 独立审查（spec 合规 / 正确性 / 代码库一致性）— acceptance: 无 critical；critical 已修复并复审 (covers: S2.1, S2.2, S2.3, S2.4; depends: T7)
- [ ] T9: Finalize 文档与收尾请示 — acceptance: 本文件 `status: delivered` + Report；提出 merge/PR/keep 选项 (covers: S2.5; depends: T8)
