---
name: better-review
description: 本地 PR review 工具：Workbench 布局，冷板岩中性色，typography-as-signal
colors:
  bg-canvas-light: 'oklch(0.97 0.005 240)'
  bg-canvas-dark: 'oklch(0.20 0.012 240)'
  bg-main-light: 'oklch(0.985 0.003 240)'
  bg-main-dark: 'oklch(0.16 0.010 240)'
  bg-raised-light: 'oklch(0.955 0.006 240)'
  bg-raised-dark: 'oklch(0.22 0.012 240)'
  bg-sunken-light: 'oklch(0.94 0.008 240)'
  bg-sunken-dark: 'oklch(0.18 0.011 240)'
  ink-primary-light: 'oklch(0.22 0.010 240)'
  ink-primary-dark: 'oklch(0.92 0.005 240)'
  ink-secondary-light: 'oklch(0.45 0.008 240)'
  ink-secondary-dark: 'oklch(0.70 0.007 240)'
  ink-muted-light: 'oklch(0.62 0.006 240)'
  ink-muted-dark: 'oklch(0.50 0.006 240)'
  rule-light: 'oklch(0.88 0.006 240)'
  rule-dark: 'oklch(0.30 0.008 240)'
  brand-light: 'oklch(0.52 0.13 245)'
  brand-dark: 'oklch(0.72 0.14 245)'
  btn-primary-bg-light: 'oklch(0.92 0.06 245)'
  btn-primary-bg-dark: 'oklch(0.32 0.07 245)'
  btn-primary-border: 'oklch(0.55 0.13 245)'
  btn-primary-ink-light: 'oklch(0.22 0.010 240)'
  btn-primary-ink-dark: 'oklch(0.96 0.005 240)'
  severity-must-light: 'oklch(0.55 0.18 25)'
  severity-must-dark: 'oklch(0.68 0.18 25)'
  severity-should-light: 'oklch(0.62 0.13 75)'
  severity-should-dark: 'oklch(0.74 0.14 80)'
  severity-nit-light: 'oklch(0.55 0.10 200)'
  severity-nit-dark: 'oklch(0.70 0.09 200)'
  accent-ready-light: 'oklch(0.54 0.13 155)'
  accent-ready-dark: 'oklch(0.72 0.13 155)'
  accent-running-light: 'oklch(0.60 0.16 140)'
  accent-running-dark: 'oklch(0.78 0.17 140)'
typography:
  display:
    fontFamily: 'Inter, Noto Sans SC, ui-sans-serif, system-ui, sans-serif'
    fontSize: '32px'
    fontWeight: 800
    lineHeight: '36px'
    letterSpacing: '-0.02em'
  h1:
    fontFamily: 'Inter, Noto Sans SC, ui-sans-serif, system-ui, sans-serif'
    fontSize: '22px'
    fontWeight: 700
    lineHeight: '28px'
    letterSpacing: '-0.01em'
  h2:
    fontFamily: 'Inter, Noto Sans SC, ui-sans-serif, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 600
    lineHeight: '22px'
  body:
    fontFamily: 'Inter, Noto Sans SC, ui-sans-serif, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '22px'
  meta:
    fontFamily: 'Inter, Noto Sans SC, ui-sans-serif, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 500
    lineHeight: '16px'
  caps:
    fontFamily: 'Inter, Noto Sans SC, ui-sans-serif, system-ui, sans-serif'
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
    backgroundColor: '{colors.btn-primary-bg-light}'
    borderColor: '{colors.btn-primary-border}'
    textColor: '{colors.btn-primary-ink-light}'
    rounded: '{rounded.md}'
    padding: '8px 14px'
    typography: '{typography.body}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-primary-light}'
    rounded: '{rounded.md}'
    padding: '6px 10px'
    typography: '{typography.body}'
  button-danger:
    backgroundColor: 'transparent'
    textColor: '{colors.severity-must-light}'
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
  severity-label:
    backgroundColor: 'transparent'
    layout: 'inline → CAPS'
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

**Creative North Star: "Workbench / IDE-native"**

`better-review` 的 UI 是一台只为评审 PR 而存在的小型 IDE：极窄的 ActivityBar 承担一级导航，Sidebar 列出所有 review session，主区是 editor canvas，右侧 Inspector 抽屉式呈现选中 finding 的详情。整套布局 在 VS Code / JetBrains 旁边并排打开时不应显得「外来」——它继承同一族层级语言，但不复刻其皮肤。

色彩策略是 **Quiet by default, considered when not**：中性色全部贴 cool slate（hue 240）一线，深浅两套都几乎无饱和；主品牌色 `--brand` 用 hue 245 的板岩蓝，与中性同家族但拉高 chroma，作为「值得被看见」的瞬间标记——primary 按钮的描边、active nav 的 2px 强调、focus ring、SubmitDrawer 顶部的 brand 线。`--brand` 不铺底，不染大面积。

明确拒绝的样子：Vercel / Linear 那种 chartreuse-on-black、shadcn 默认皮肤、GitHub 行政化的灰、SaaS hero metric template、AI workflow tool 通用模板（白底浅紫圆角卡片+dot grid）、Cursor / Warp 那种「重设计的终端」。同时 **不一比一复刻 VS Code Dark+**：Workbench 是 IDE-native，但不是 VS Code 的 reskin。

**Key Characteristics:**

- 四栏 Workbench 布局（ActivityBar / Sidebar / Main / Inspector），不是单页 hero。
- 双 theme 同等精修：light 是「冷纸 Cool Paper」（hue 240），dark 是「暮光 Dusk」（hue 240，L 0.16–0.22）。dark 默认 0.20 canvas，main 区最深 0.16，raised 上抬到 0.22；light 镜像反过来（main 0.985 最亮、raised 0.955 略压暗）。
- Severity 用 inline `→ CAPS` 词组传达（替代旧的 64px 垂直 wordmark），色彩降为辅助信号。
- Findings 是表格行，不是卡片；详情迁到 Inspector，按文件分组的卡片堆叠是被显式删除的反模式。
- 键盘 affordance 显式可见：高频快捷键（`e` 编辑、`⌘S` 保存、`⌘⏎` 提交）都通过 `<KbdHint>` / `<KbdTooltip>` 露出。

## 2. Colors: The Slate-on-Cool-Paper Palette

中性色全部对齐 hue 240（cool slate），低 chroma（≤0.012），避开 #fff/#000 的工业感和旧版的暖朱红识别。Severity 三色仍由语义驱动，保留原先 hue 25 / 75 / 200，但在新的冷底上对比关系被重新核对过。

### Primary

- **Slate Blue** (`oklch(0.52 0.13 245)` light / `oklch(0.72 0.14 245)` dark)：品牌主色。落在 active nav 边框（2px）、focus ring、Submit drawer 的 brand 顶横线、Tag `tone="brand"` 的填充。约占可视面积 5–10%，绝不铺地。

### Primary Button (B4 Dual)

primary 按钮单独用一组 token，与 `--brand` **解耦**——理由是按钮要是「被构造的开关」而不是「营销 CTA」。

- `--btn-primary-bg` (`oklch(0.92 0.06 245)` light / `oklch(0.32 0.07 245)` dark)：低 chroma 的板岩底，亮度贴近 chrome。
- `--btn-primary-border` (`oklch(0.55 0.13 245)`，两 theme 共用)：响亮的 1px 描边，是按钮真正的视觉锚点。
- `--btn-primary-ink` (`oklch(0.22 0.010 240)` light / `oklch(0.96 0.005 240)` dark)：浅墨字。
- hover 时通过 `color-mix(in oklch, var(--btn-primary-bg) 85%, var(--btn-primary-border))` 让底色微微往描边色拉。

### Secondary（语义动态）

- **Pulse Mint** (`oklch(0.60 0.16 140)` light / `oklch(0.78 0.17 140)` dark)：sidebar 上 _正在运行_ 的 session 左缘 1px 脉冲线 + MainTabs 的 Transcript tab streaming 圆点。UI 中唯二的非交互动画来源。
- **Ready** (`oklch(0.54 0.13 155)` / `oklch(0.72 0.13 155)`)：daemon 健康灯、Tag `tone="success"`。

### Tertiary（severity 三色，仅用于 `→ CAPS` 文色）

- **Severity Must** (`oklch(0.55 0.18 25)` / `oklch(0.68 0.18 25)`)：MUST 文色。仍是 vermilion-family 红，刻意与 brand（240/245 蓝调）保持 hue 距离，强化「红 = must」的语义切片。
- **Severity Should** (`oklch(0.62 0.13 75)` / `oklch(0.74 0.14 80)`)：SHOULD 文色，honey/ochre。离开 amber（hue 60）一档，避开 SaaS 反射。
- **Severity Nit** (`oklch(0.55 0.10 200)` / `oklch(0.70 0.09 200)`)：NIT 文色，cool steel。

### Neutral

| 角色              | Light                    | Dark                    | 说明                                                        |
| ----------------- | ------------------------ | ----------------------- | ----------------------------------------------------------- |
| `--bg-canvas`     | `oklch(0.97 0.005 240)`  | `oklch(0.20 0.012 240)` | 默认 shell（活动栏 / 侧栏背后的画布层）                     |
| `--bg-main`       | `oklch(0.985 0.003 240)` | `oklch(0.16 0.010 240)` | 主区，editor 类比中的「纸面」。深色下是整套配色里最深的层。 |
| `--bg-raised`     | `oklch(0.955 0.006 240)` | `oklch(0.22 0.012 240)` | ActivityBar、Sidebar、Inspector、drawer 这些 chrome 表面。  |
| `--bg-sunken`     | `oklch(0.94 0.008 240)`  | `oklch(0.18 0.011 240)` | 压陷（textarea 底、code block 底）。                        |
| `--ink-primary`   | `oklch(0.22 0.010 240)`  | `oklch(0.92 0.005 240)` | 正文。                                                      |
| `--ink-secondary` | `oklch(0.45 0.008 240)`  | `oklch(0.70 0.007 240)` | meta、label、文件路径。                                     |
| `--ink-muted`     | `oklch(0.62 0.006 240)`  | `oklch(0.50 0.006 240)` | placeholder、关闭项。                                       |
| `--rule`          | `oklch(0.88 0.006 240)`  | `oklch(0.30 0.008 240)` | 1px 分隔线。                                                |

## 3. Typography

排版承担一半的视觉体量。display 字阶 ≥1.45 ratio，display→h1 用 weight 拉开，h1→h2 用 size + weight 双轴拉开。**不引入 serif**，避免 editorial 误读，保 IDE 体感。

- **Display (32px / 800 / -0.02em)**：页面顶部 wordmark、PR 标题、Home 主标语、Settings 顶 `runtime`。
- **H1 (22px / 700 / -0.01em)**：章节标题，配合 SectionHeader 的 eyebrow caps 使用，也是 Inspector 内 finding title。
- **H2 (16px / 600)**：子标题。
- **Body (14px / 400)**：finding body、settings 的 dd 值、review body 编辑器。
- **Meta (12px / 500)**：session meta 行、PR meta 行、status bar。
- **Caps (11px / 700 / 0.06em uppercase)**：severity wordmark、section eyebrow、status tag、kbd hint、ActivityBar tooltip。
- **Code (JetBrains Mono 13px / 450, `tnum` + `ss01`)**：file:line、PR number `#218`、agent transcript、diff 行号。

字体加载：本地自托管 `@fontsource/inter` + `@fontsource/jetbrains-mono` + `@fontsource/noto-sans-sc`。`Noto Sans SC` 用作中文兜底，按需子集化由 Vite 处理。运行时不发起 web font 网络请求。

## 4. Elevation

整个系统是**几乎平的**。没有阴影 token，没有 box-shadow（focus ring + drawer 投影除外）。层级关系靠：

1. **背景亮度差**（main → canvas → raised，差 2–4% 亮度）。Light 模式下 `main` 最亮（`0.985`），dark 模式下 `main` 最深（`0.16`）——两套都用「main = editor 的纸面，chrome = 抬高的工具栏」这个隐喻，只是物理方向相反。
2. **1px rule 线**（`--rule`）。findings 表格行之间、Inspector section 之间、Settings 的 dl 行之间、MainTabs 的 tab strip 底缘。
3. **brand 2px 强调线**作为「重要时刻」的标记 —— ActivityBar / MainTabs 选中项的左/下沿 2px brand strip、SubmitDrawer 顶部 1px brand 横线、DaemonStatus 在 default agent 缺失时以 `--severity-must` 圆点 + `animate-pulse` 替代 brand 高亮，提示阻塞而非促销。

唯一允许的 box-shadow：focus ring（`outline: 1.5px solid var(--brand)` + `outline-offset: 2px`）+ 浮层（DaemonStatus / LanguageSwitcher popover、SubmitDrawer 抽屉）的 elevation 阴影 `0 8px 30px -12px color-mix(...)`。其它任意位置一律不要 box-shadow blur。

## 5. Components

### ActivityBar

56px 竖向条：品牌 mark → 路由图标（Sessions `/` / Prompt `/prompt` / Settings `/settings`）→ flex spacer → ThemeToggle / LanguageSwitcher / DaemonStatus。每个 nav 图标在选中时左缘出现 2px brand strip + `bg-canvas` 高亮（VS Code 同款 affordance），未选中时透明。整体 `bg-raised`，与 Sidebar 在同一 chrome 层。

底部三个工具按钮的浮层（语言菜单、daemon 状态）**统一锚点到自身右侧** —— `absolute left-[calc(100%+8px)] bottom-0`，避免在屏幕左下角向下/向左展开时被裁切。

### Sidebar

300px 默认宽度（可 256–560 拖拽，localStorage key `better-review:sidebar-width:v2`）。**仅在「会话」相关路由 `/` 和 `/pr/:id` 上挂载**；`/prompt` / `/settings` 不渲染 sidebar（在 App.tsx 用 `matchPath` 做路由守卫）。Sidebar 是会话面板，不是全局 chrome。

顶部 chrome 区由三层 stack 组成（`px-4 pt-3 pb-2.5`，下沿 1px rule）：

1. **Header 行**：`Sessions` caps eyebrow + `共 N 个` mono total，右侧固定一个紧凑的 `+ New review` primary 按钮（28px 高，沿用 B4 dual token），点击回到 `/`。原本独占 56px 的横幅式 NavLink 被显式删除——它视觉太重、和「新建」语义又匹配不准。
2. **Search input**：28px 高，flat（`bg-canvas` + `border-rule`），左缘 search 图标。匹配 `title / owner / repo / owner/repo / owner/repo#number / @author` 任一子串（大小写不敏感）；纯数字（带或不带 `#` 前缀）单独匹配 PR number。空查询时右端显示 `⌘K` kbd 提示，输入后变为清除按钮。`⌘K` / `Ctrl+K` 在 sidebar 挂载期间全局 focus + select search。
3. **状态筛选 chip 行**：三个 toggle chip（Active / Done / Stale），各带 mono 计数；可任意组合多选，状态持久化到 localStorage `better-review:sidebar-filter:v1`。三 chip 全关时回退到「全开」，避免出现「我把所有都关掉了，列表就空了」的死锁。这是整个 UI **唯一** 的 rounded-full 形状——见 §6 的例外说明。

下方按 `active / done / stale` 三段分组的 session 列表保持不动：组头 caps + mono 计数 + 1px rule。当搜索 / 筛选导致列表为空时，渲染 `noMatch` EmptyState（「没有会话符合当前筛选」），与首次安装的 `empty` 状态语义区分。

**反模式更新**：原本的 active 行 2px brand 左边框被显式删除——选中态只用 `bg-canvas` 表示。运行中的会话仍保留左缘 1px `accent-running` 脉冲线（这是「有事在跑」的环境信号，不可删）。

### Main + MainTabs

`main` 元素铺满 `bg-main`，是整个 UI 中唯一与 chrome 不同色的表面。`PRDetail` 在 main 内 mount `<MainTabs>`：顶部 `[Findings] [Transcript]` 二选一切换，下沿 1px rule 分隔。

- 选中 tab：`text-ink-primary` + 2px brand 下沿。
- Findings tab：渲染 `<FindingList>`（扁平表格行）+ PR-wide 段落分隔。
- Transcript tab：渲染 `<AgentOutputPanel>`（full-pane，**不再**用 `<details>` 折叠）。Streaming 时 Transcript tab 标签旁出现 `accent-running` 1.5px 脉冲圆点。

tab 选中态用 URL search param 持久化（`?tab=transcript`），方便分享与刷新。

### Inspector + InspectorDock

360px 右侧栏，`bg-raised`。`<InspectorDock>` 用 `matchMedia('(min-width: 1280px)')` 判断：

- ≥1280px：常驻为右侧第四列。
- <1280px：当前先不渲染（后续 phase 可补 drawer 模式）。

未选中 finding 时显示 `EmptyState`。选中后渲染 `<FindingDetailPanel>`，它通过 TanStack Query 共享 PRDetail 的 session/diff 缓存。结构：

```
severity tag · finding.id
H1 title
<dl>: Category / Target (file:line + GitHub link)
[severity radio group ── 仅 edit 模式]
SECTION Claim         (markdown 渲染)
SECTION Suggestion    (code block 或 "No suggestion provided.")
SECTION Source        (DiffViewer，仅当 line 已知)
─────────────────────────
sticky footer:
  [Submit review]    [Edit]  [Discard]
  (edit 模式) [Cancel] [Save]
```

### FindingRow

扁平行：`[checkbox] · → SEVERITY · title · path:line · category` + 可选 `edited` 图标。点击行体（非 checkbox）通过 `SelectionContext` 设置 `selectedFindingDbId`；checkbox 独立 stopPropagation，专门用于 select/unselect。

active 行用 `bg-canvas` + 左缘 2px brand strip 标记。**没有** hover edit/delete 按钮 —— 这些动作只在 Inspector CTA 区域出现，行本身保持一致的稠密性。

### Button (`primary` / `ghost` / `danger`)

三种变体（`ink` 变体已经被 primary 吸收并删除）。

- **primary**：B4 Dual treatment（见上）。`bg-[--btn-primary-bg]` + `border-[--btn-primary-border]` + `text-[--btn-primary-ink]`，hover 时底色向 border 微移。整体效果是「被构造的开关」，描边响亮 + 底色安静。
- **ghost**：透明底 + `ink-primary` 文字 + hover `bg-raised`。
- **danger**：透明底 + `severity-must` 文字 + hover `bg-sunken` + `border-severity-must/50`。

不允许：`rounded-full` 胶囊按钮、渐变背景按钮、icon-only 按钮（必须有 aria-label，且至少有 `<KbdHint>` 暴露键盘等价）。

### Tag (`neutral` / `brand` / `success` / `warning` / `danger`)

12px / 700 / 0.06em uppercase，4px 圆角，`2px 6px` padding，无 dot 图标。仅用文字 + 色彩传达 tone。应用：session 状态徽章、category pill、PromptEditor 的 READ ONLY、Settings 的 MISSING、Submit drawer 的 INLINE / MOVED / PR-WIDE。

### SeverityLabel

`inline-flex` 的 `→ CAPS` 词组，替代旧的 64px 垂直 wordmark：

```html
<span
  data-level="must"
  aria-label="severity: must"
  class="inline-flex items-center gap-1 text-caps tracking-caps uppercase text-severity-must"
>
  <span aria-hidden="true">→</span>
  <span>MUST</span>
</span>
```

色彩、字重、aria-label 都按 severity 切换；右箭头是 caps 词组的视觉锚，强调「指向某事」的语义。

### SectionHeader / EmptyState / KbdHint / ScrollPin / ConfirmAction

保留原有定义。`ScrollPin` 仍在 `AgentOutputPanel` 内浮于右下角，处理 unpin/follow 切换。`ConfirmAction` 给 Inspector 的 Discard 提供模态确认。

### Input flat

无外框输入框：透明底，仅底部 1px `--rule` 线，focus 时 line 变 brand。用于 Inspector 内的标题编辑、SubmitDrawer 的 review body 编辑器。

## 6. Do's and Don'ts

### ✅ Do

- 用排版传达层级：display → h1 → h2 → body → meta → caps，每一步都有可识别的 size 或 weight 跳跃。
- 用 1px rule 线（`--rule`）做分组：finding 行之间、Inspector section 之间、MainTabs 底缘、Settings dl 行之间。
- 用 `→ CAPS` 表达 severity，让色彩降为辅助信号。
- 让 `--brand` 出现在「值得被看见」的瞬间：ActivityBar/Sidebar 选中态、MainTabs 选中下沿、focus ring、SubmitDrawer 顶横线、Tag `tone="brand"`。
- primary 按钮用 B4 token 而非 `--brand` 铺底 —— 描边响亮 + 底色安静，避免 SaaS CTA 反射。
- 显式露出键盘 affordance：`<KbdHint>`、`<KbdTooltip>`、Inspector 的 `e` / `⌘⏎` / `Esc`。
- light 默认冷纸（不要纯白），dark 默认 dusk 0.20 / main 0.16（不要纯黑）。所有中性色 chroma ≥ 0.003。
- 遵守 `prefers-reduced-motion`：sidebar pulse、Transcript tab 脉冲、drawer transition 在 reduce 下退化为 instant。

### ❌ Don't

- **不要** Vercel / Linear chartreuse-on-black 的高 chroma 加速感；我们刻意走低 chroma 板岩蓝来反向定位。
- **不要** shadcn 默认皮肤（zinc + sky + everything-is-a-card）。
- **不要** 一比一复刻 VS Code Dark+。Workbench 是 IDE-native 不等于 IDE 复刻；我们的字体、字阶、按钮、severity 表达都不同。
- **不要** SaaS hero-metric template：大数字 + 小标签 + 渐变 accent + 三栏统计。
- **不要** identical card grids、step-indicator 圆圈、`background-clip: text` 渐变文字、装饰性 glassmorphism。
- **不要** `border-left` / `border-right` 大于 2px 作色 stripe。原来 FindingCard 4px 左侧 stripe 已显式删除。
- **不要** em dash（`—` 或 `--`）出现在任何用户可见文案。用逗号、冒号、分号、句号、括号代替。
- **不要** 在 UI 文案中堆砌 emoji。仅在用户配置的 finding markdown 中允许（agent 输出尊重原样）。
- **不要** 把动作按钮、Tag、status badge 做成 rounded-full 胶囊形，也不要在状态指示器上加圆点装饰。**例外**：sidebar 顶部的状态筛选 chip 是 segmented toggle 控件（不是 CTA、不是行内 badge），允许使用 rounded-full + 状态色小圆点作为开关 affordance。新组件如要复用这套形状，必须同时具备「toggle group」「持久化筛选状态」「不承载行业内 status 语义」三条特征。
- **不要** 渐变 icon。
- **不要** 在 light 用 `#ffffff`，在 dark 用 `#000000`。
- **不要** 用颜色作为 severity 的 _唯一_ 信号。`→ CAPS` 文字始终是首要载体；颜色是辅助。
- **不要** nested cards 或按文件分组的卡片堆叠 —— findings 已扁平化为表格行，详情在 Inspector。

## 7. Accessibility & Inclusion

- 目标 WCAG AA。light / dark 两套 token 中，正文（`--ink-primary`）对画布（`--bg-canvas`、`--bg-main`）保证 ≥ 4.5:1，meta 文（`--ink-secondary`）保证 ≥ 3:1。
- Severity 颜色只是 _额外信号_；首要载体是 `→ CAPS` 文字，色弱用户不会丢失信息。
- 所有动效遵守 `prefers-reduced-motion`：sidebar running pulse、Transcript tab 脉冲、drawer transition、hover transition 都在 `@media (prefers-reduced-motion: reduce)` 下退化为 instant。
- 键盘可达：所有交互（编辑 finding、切换 tab、提交 review、关闭 drawer、resize sidebar）都有键盘路径；focus ring 用 `--brand` 1.5px outline-offset 2px。
- 不依赖 hover 才能发现的功能：Inspector 的 CTA strip 默认显示；finding 行不再藏 hover affordance。
