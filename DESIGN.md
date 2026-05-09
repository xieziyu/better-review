---
name: better-review
description: 本地 PR review 工具：dev-tool 美学，editorial 排版，朱红 commitment
colors:
  bg-canvas-light: 'oklch(0.98 0.006 70)'
  bg-canvas-dark: 'oklch(0.18 0.012 25)'
  bg-raised-light: 'oklch(0.96 0.008 70)'
  bg-raised-dark: 'oklch(0.22 0.014 25)'
  bg-sunken-light: 'oklch(0.94 0.010 70)'
  bg-sunken-dark: 'oklch(0.15 0.010 25)'
  ink-primary-light: 'oklch(0.22 0.012 25)'
  ink-primary-dark: 'oklch(0.95 0.005 25)'
  ink-secondary-light: 'oklch(0.45 0.010 25)'
  ink-secondary-dark: 'oklch(0.70 0.008 25)'
  ink-muted-light: 'oklch(0.62 0.008 25)'
  ink-muted-dark: 'oklch(0.50 0.008 25)'
  rule-light: 'oklch(0.88 0.008 25)'
  rule-dark: 'oklch(0.30 0.010 25)'
  brand-light: 'oklch(0.58 0.20 28)'
  brand-dark: 'oklch(0.66 0.19 30)'
  severity-must-light: 'oklch(0.55 0.18 25)'
  severity-must-dark: 'oklch(0.68 0.18 25)'
  severity-should-light: 'oklch(0.62 0.13 75)'
  severity-should-dark: 'oklch(0.74 0.14 80)'
  severity-nit-light: 'oklch(0.55 0.10 200)'
  severity-nit-dark: 'oklch(0.70 0.09 200)'
  accent-running-light: 'oklch(0.70 0.16 140)'
  accent-running-dark: 'oklch(0.78 0.17 140)'
typography:
  display:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '32px'
    fontWeight: 800
    lineHeight: '36px'
    letterSpacing: '-0.02em'
  h1:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '22px'
    fontWeight: 700
    lineHeight: '28px'
    letterSpacing: '-0.01em'
  h2:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 600
    lineHeight: '22px'
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '22px'
  meta:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 500
    lineHeight: '16px'
  caps:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 700
    lineHeight: '14px'
    letterSpacing: '0.06em'
  code:
    fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '13px'
    fontWeight: 450
    lineHeight: '20px'
    fontFeature: '"tnum" 1, "ss01" 1'
rounded:
  none: '0px'
  sm: '4px'
  md: '6px'
  lg: '10px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  base: '16px'
  lg: '24px'
  xl: '32px'
  xxl: '48px'
components:
  button-primary:
    backgroundColor: '{colors.brand-light}'
    textColor: '{colors.bg-canvas-light}'
    rounded: '{rounded.md}'
    padding: '8px 14px'
    typography: '{typography.body}'
  button-ink:
    backgroundColor: '{colors.ink-primary-light}'
    textColor: '{colors.bg-canvas-light}'
    rounded: '{rounded.md}'
    padding: '8px 14px'
    typography: '{typography.body}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-primary-light}'
    rounded: '{rounded.md}'
    padding: '6px 10px'
    typography: '{typography.body}'
  tag-neutral:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-secondary-light}'
    rounded: '{rounded.sm}'
    padding: '2px 6px'
    typography: '{typography.caps}'
  tag-brand:
    backgroundColor: '{colors.brand-light}'
    textColor: '{colors.bg-canvas-light}'
    rounded: '{rounded.sm}'
    padding: '2px 6px'
    typography: '{typography.caps}'
  severity-label-must:
    backgroundColor: 'transparent'
    textColor: '{colors.severity-must-light}'
    typography: '{typography.caps}'
  severity-label-should:
    backgroundColor: 'transparent'
    textColor: '{colors.severity-should-light}'
    typography: '{typography.caps}'
  severity-label-nit:
    backgroundColor: 'transparent'
    textColor: '{colors.severity-nit-light}'
    typography: '{typography.caps}'
  input-flat:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-primary-light}'
    rounded: '{rounded.none}'
    padding: '8px 0'
    typography: '{typography.body}'
---

# Design System: better-review

## 1. Overview

**Creative North Star: "Editor's Margin Notebook"**

`better-review` 的 UI 是一本被排版过的批注本：左侧 sidebar 像桌面上摊开的 PR 索引卡，主区域像作家在咖啡桌上修改稿件时随手写下的旁注。findings 不是「卡片」，是被认真排版的边注；severity 不是「色块」，是被加粗的 caps 词头。整个系统的视觉记忆点在**排版**而不在**色彩**——只有当语义需要颜色时（提交动作、运行状态、严重度提示、品牌时刻），饱和的朱红才出现。

色彩策略是 **Committed**：单一品牌色（warm vermilion，朱红 hue 25–30）承担识别工作，但不靠它铺满 30–60% 的表面；表面通过深墨（dark）/ 暖象牙（light）的中性主导，把朱红留在按钮、active 下划线、运行脉冲、强提交时刻这些「值得被看见」的瞬间。这是为了避开 chartreuse-on-black 这一已被工业过度饱和的二阶反射。

明确拒绝的样子：Vercel-style chartreuse 加速感、shadcn 浅蓝白卡片、GitHub 行政化的灰，以及任何 SaaS hero-metric template。我们是单用户的本地工具，没有义务取悦每一种审美。

**Key Characteristics:**

- Bold register（committed color strategy），但 commitment 落在排版而非铺色。
- 双 theme 同等精修，跟随系统 `prefers-color-scheme`，dark 默认偏深墨而非纯黑，light 默认偏暖 bone 而非冷白。
- Severity 用 caps wordmark + 字重对比传达，色彩降为辅助信号。
- 无 nested cards，无 step-indicator 圆圈，无渐变文字，无装饰性 glassmorphism。
- 键盘 affordance 显式可见：高频快捷键（`e` 编辑、`⌘S` 保存、`⌘⏎` 提交、`/` 过滤）都通过 `<KbdHint>` 露出。

## 2. Colors: The Vermilion-on-Bone Palette

中性色家族全部往朱红 hue（25 / 70）微偏，避免 #fff / #000 的工业冷感。Severity 三色调离 SaaS 默认（red/amber/emerald），改为 vermilion / honey / cool steel，让 amber 与 emerald 的 SaaS 反射味退场。

### Primary

- **Warm Vermilion** (`oklch(0.58 0.20 28)` light / `oklch(0.66 0.19 30)` dark)：品牌主色。落在 primary 按钮、active nav 下划线（2px）、focus ring、提交时刻的横线分隔、health banner 反色背景。约占可视面积 5–10%，绝不铺地。

### Secondary

- **Pulse Mint** (`oklch(0.70 0.16 140)` light / `oklch(0.78 0.17 140)` dark)：仅用于 sidebar 上 _正在运行_ 的 session 项左缘 1px 脉冲线。这是整个 UI 中唯一的非交互动画，作为「有事在跑」的环境信号，不在其他地方复用。

### Tertiary（severity 三色，仅在 caps wordmark 上用）

- **Severity Must** (`oklch(0.55 0.18 25)` / `oklch(0.68 0.18 25)`)：MUST 标签文色，与 brand 同 hue 但提高 chroma，hover/focus 时不透明，静态时 0.7 alpha。
- **Severity Should** (`oklch(0.62 0.13 75)` / `oklch(0.74 0.14 80)`)：SHOULD 标签文色，honey/ochre。刻意离开 amber（hue 60）一档，避开 SaaS 反射。
- **Severity Nit** (`oklch(0.55 0.10 200)` / `oklch(0.70 0.09 200)`)：NIT 标签文色，cool steel。刻意离开 emerald（hue 145），避开 SaaS 反射。

### Neutral

- **Bone Canvas** (`oklch(0.98 0.006 70)` light) / **Deep Ink Canvas** (`oklch(0.18 0.012 25)` dark)：主画布。
- **Raised Surface** (`oklch(0.96 0.008 70)` / `oklch(0.22 0.014 25)`)：上层（sidebar 列、drawer、card 极少时刻）。差值 ≤2% 亮度，避免明显「卡片堆叠感」。
- **Sunken Surface** (`oklch(0.94 0.010 70)` / `oklch(0.15 0.010 25)`)：凹陷（input 底、code block 底）。
- **Ink Primary** (`oklch(0.22 0.012 25)` / `oklch(0.95 0.005 25)`)：正文。
- **Ink Secondary** (`oklch(0.45 0.010 25)` / `oklch(0.70 0.008 25)`)：meta、label、文件路径辅助。
- **Ink Muted** (`oklch(0.62 0.008 25)` / `oklch(0.50 0.008 25)`)：placeholder、已读状态、关闭项。
- **Rule** (`oklch(0.88 0.008 25)` / `oklch(0.30 0.010 25)`)：1px 分隔线 / finding 之间的水平规则。

## 3. Typography

排版承担一半的视觉体量。display 字阶 ≥1.45 ratio，display→h1 用 weight 拉开，h1→h2 用 size + weight 双轴拉开。**不引入 serif**，避免 editorial 误读，保 dev tool 体感。

- **Display (32px / 800 / -0.02em)**：页面顶部 wordmark、PR 标题、Home 主标语、Settings 顶 `runtime`。
- **H1 (22px / 700 / -0.01em)**：章节标题，配合 SectionHeader 的 eyebrow caps 使用。
- **H2 (16px / 600)**：子标题、finding title。
- **Body (14px / 400)**：finding body、settings 的 dd 值、review body 编辑器。
- **Meta (12px / 500)**：session meta 行、PR meta 行、status bar。
- **Caps (11px / 700 / 0.06em uppercase)**：severity wordmark、section eyebrow、status tag、kbd hint。
- **Code (JetBrains Mono 13px / 450, `tnum` + `ss01`)**：file:line、PR number `#218`、agent transcript、diff 行号。

字体加载：项目继续使用本地 Inter + JetBrains Mono（不新增 web font request），display 体效果通过 `font-weight: 800` 与 `font-feature-settings: "ss01" 1, "cv11" 1` 实现，而不是引入 Inter Display 单独子家族。

## 4. Elevation

整个系统是**几乎平的**。没有阴影 token，没有 box-shadow（focus ring 除外）。层级关系靠：

1. **背景亮度差**（canvas → raised → sunken，差 2–4% 亮度），不靠投影。
2. **1px rule 线**（`--rule`）。findings 之间、sidebar section 之间、settings 的 dl 行之间用水平规则线分组。
3. **brand 1px 顶横线**作为「重要时刻」的标记 —— SubmitDrawer 顶部、sidebar running 项左缘脉冲；DaemonStatus 在 default agent 缺失时以 `--severity-must` 圆点 + `animate-pulse` 替代 brand 高亮，提示这是阻塞而非促销。

唯一允许的 box-shadow 是 focus ring：`outline: 1.5px solid var(--brand)` + `outline-offset: 2px`，不要 box-shadow blur。

理由：扁平不是为了极简风格，而是因为这是 dev tool；阴影会让 UI 在 1.5x DPR 监视器上显得「廉价」，rule 线则在任意 DPR 下都干净。

## 5. Components

### Button (`button-primary` / `button-ink` / `button-ghost` / `button-danger`)

四种变体，统一 6px 圆角，padding 按尺寸两档（`8px 14px` 默认，`6px 10px` ghost）。

- **primary**：`bg-brand` + `text-brand-ink`，用于「主提交动作」（Submit Review、Save Prompt）。
- **ink**：`bg-ink-primary` + `text-bg-canvas`，强黑底白字，用于 brand-moments 的强按钮（Home 上的 Submit、SubmitDrawer 提交按钮）—— 与 primary 形成「色 vs 重」的双轴对比。
- **ghost**：透明底 + `ink-primary` 文字 + hover 时 `bg-raised`，用于次级 action（rerun、open in github、cancel）。
- **danger**：透明底 + `severity-must` 文字 + hover 时 `bg-sunken`，用于破坏性 action（delete finding）。

不允许：`rounded-full` 胶囊按钮、渐变背景按钮、icon-only 按钮（必须有 aria-label，且至少有 `<KbdHint>` 暴露键盘等价）。

### Tag (`tag-neutral` / `tag-brand` / `tag-success` / `tag-warning` / `tag-danger`)

12px / 700 / 0.06em uppercase，4px 圆角，`2px 6px` padding，无 dot 图标。仅用文字 + 色彩传达 tone。
应用：session 状态徽章（RUNNING / READY / FAILED）、category pill、PromptEditor 的 READ ONLY 标签、Settings 的 MISSING 标签。

### SeverityLabel (`severity-label-must` / `should` / `nit`)

垂直 caps wordmark，等宽 64px 列固定占位（无论文字长短）。

- 静态：`color: var(--severity-{level})` + `opacity: 0.7`。
- Hover/focus（FindingCard 容器级）：`opacity: 1`。
- letter-spacing `0.08em`，font-weight 700。
- 不带任何 background、border、icon。

### SectionHeader

eyebrow（caps 11px）+ title（h1 22px / 700）+ 可选 actions 槽位。统一所有页面的节标题（findings 列表头、Home 的 recent 列表头、sidebar Active/Done/Stale 三段头、Settings 三组头）。

### KbdHint

由 `<kbd>` 元素组成的小型提示，每个 key 渲染为 `<kbd>` 元素，11px / 600 / 边框 1px `--rule` / 4px 圆角。多 key 之间用 `+` 连接。可选 label 在右侧用 ink-muted 11px 显示。

### EmptyState

eyebrow + display 标题 + 一行 body + 可选 cta 按钮。统一 sidebar 空、findings 空、Home 无 recent 的状态语气。

### ScrollPin

显式控件，替换 AgentOutputPanel 内的隐式 pin 逻辑。当用户向上滚动后展示「PINNED 12 lines below」+ 一个 `[unpin] / [follow]` 切换；用户在底部时收起。

### Input flat (`input-flat`)

无外框输入框：透明底，仅底部 1px `--rule` 线，focus 时 line 变 brand 色（`--brand`），placeholder 用 `--ink-muted`。应用于 Sidebar 的命令式 PR URL 输入、SubmitDrawer 的 review body 编辑器、PromptEditor 的搜索框（如有）。

## 6. Do's and Don'ts

### ✅ Do

- 用排版传达层级：display → h1 → h2 → body → meta → caps，每一步都有可识别的 size 或 weight 跳跃。
- 用 1px rule 线（`--rule`）做分组：finding 之间、section 之间、Settings 的 dl 行之间。
- 用 caps wordmark 表达「类别 / 状态 / severity」：RUNNING、READY、MUST、SHOULD、NIT、READ ONLY、MISSING、INLINE、PR-WIDE。
- 让品牌色 `--brand` 出现在「值得被看见」的瞬间：primary 按钮、active nav 下划线、focus ring、SubmitDrawer 顶横线、DaemonStatus 浮层里 default agent 的标签。
- 显式露出键盘 affordance：finding 的 `e`、PromptEditor 的 `⌘S`、SubmitDrawer 的 `⌘⏎`、计划中的 `/` 过滤，都用 `<KbdHint>`。
- 在 dark 默认深墨偏暖红（不要纯黑），light 默认 bone 暖象牙（不要纯白）。所有中性色都微偏 hue 25 或 70。
- 遵守 `prefers-reduced-motion`：sidebar pulse、drawer transition、hover transition 在 reduce 下退化为 instant。

### ❌ Don't

- **不要** `border-left` / `border-right` 大于 1px 作色 stripe。FindingCard 当前的 4px 左侧 stripe 是被明确删除的反模式。
- **不要** `background-clip: text` 渐变文字。任何场景。
- **不要** 装饰性 glassmorphism / backdrop-blur。除非是真实的物理隐喻（比如 modal 背景下层模糊），否则不出现。
- **不要** SaaS hero-metric template：大数字 + 小标签 + 渐变 accent + 三栏统计。
- **不要** identical card grids：同尺寸卡片排成 3 列网格 + 图标头 + 标题 + 描述，banned。
- **不要** step-indicator 数字圆圈：SubmitDrawer 原来的「1 → 2」圈圈是反模式，必须删除并用排版叙事替代。
- **不要** em dash（`—` 或 `--`）出现在任何用户可见文案。用逗号、冒号、分号、句号、括号代替。
- **不要** 在 UI 文案中堆砌 emoji 装饰。仅在用户配置的 finding markdown 中允许（agent 输出尊重原样）。
- **不要** rounded-full 胶囊按钮、status badge 圆点、渐变 icon。
- **不要** 在 light theme 用 `#ffffff`，在 dark theme 用 `#000000`。所有中性色必须有 chroma ≥ 0.005。
- **不要** 用颜色作为 severity 的 _唯一_ 信号。caps wordmark 文字始终是首要载体；颜色是辅助。
- **不要** nested cards。一层 card 已经是最后手段，第二层永远错。
