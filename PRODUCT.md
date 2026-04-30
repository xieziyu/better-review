# Product

## Register

product

## Users

`better-review` 的使用者是一名**软件工程师**，在自己的笔记本或外接显示器上独立工作。具体使用画像：

- 单用户、本地、无团队协作。所有状态都在 `~/.better-review/` 下，没有云端，没有登录。
- 80% 的时间用键盘，习惯在终端 + 编辑器（VS Code / Vim / JetBrains）+ 浏览器之间切换；UI 必须在这三者之间不显得「廉价」。
- 同时跑多个 PR session 是常态：可能 1 个在 streaming，2 个等待 review，1 个已 ready 但还没提交。
- 评审上下文：在写代码间隙抽空看 PR、晚上回家在咖啡桌前批量过 review、或者周一上午集中清理积压。
- 接受工程口味的设计语言：稠密信息、键盘 affordance、命令行隐喻不会让他陌生；反之 SaaS 的 onboarding modal、emoji 装饰、卡片堆叠会让他觉得「这工具不懂我」。

## Product Purpose

把任意 review-agent CLI（`claude` / `codex`）+ `gh` CLI 串成一条**比终端更顺手**的 PR review 工作流。

成功状态：

- 从「想 review 一个 PR」到「review 已经在跑」≤ 2 步操作（粘 URL，回车）。
- 从「agent 出 finding」到「这条 finding 提交到 GitHub」≤ 3 步操作（勾选，写 review body，提交）。
- 同时跟进 N 个 PR 时，**侧栏一眼能看完**当前所有 session 的状态，不需要点开任何一个去确认是否还活着。
- 提交前能够手工微调 finding 措辞、严重度、suggestion，而不是被迫接受 agent 的原始输出。
- 在 claude / codex 之间切换 ≤ 1 秒（主页 toggle 或 config 改一行）。

## Brand Personality

**Confident · Editorial · Quiet-when-quiet, Loud-when-loud**

- *Confident*：每一处选择都是有立场的（「我们就是用 caps wordmark 标 severity，我们就是不用绿色加号红色减号」），不假装中立。
- *Editorial*：信息有节奏、有层级、像被排版过。不是把每条 finding 包成一张卡，而是像编辑过的批注。
- *Quiet-when-quiet, Loud-when-loud*：默认状态低噪音；但「有 PR 在 streaming」「daemon 失健」「准备提交 review」这些时刻必须立刻被看见，并且是有美感地被看见。

## Anti-references

明确**不要**长成的样子：

- **Vercel / Linear 那种 chartreuse-on-black**：当下最饱和的 dev tool 视觉反射，二阶 AI slop 高发地。
- **shadcn 默认皮肤**：cards-everywhere + zinc 灰 + 蓝色 primary，和市面上几百个项目难以区分。
- **GitHub PR 页**：信息密度可以借鉴，但视觉上是行政化、缺乏立场的。我们要做出态度。
- **SaaS hero-metric template**：大数字 + 小标签 + 渐变 accent，强 banned。
- **AI workflow tool 通用模板**：白底 / 浅紫 accent / 圆角卡片 + dot-grid 背景，避免。
- **Cursor / Warp 那种「重设计的终端」**：他们做的是 IDE / 终端本身；我们是 *围绕* PR review 的窄工具，不该撞他们的形。

## Design Principles

1. **Typography carries identity, color carries meaning**。视觉记忆点放在排版（display 字阶 + caps wordmark + mono path），不放在配色；颜色只在「需要传达 severity / status / brand commitment」的时刻才出现。
2. **Severity is signal, not decoration**。「严重度」从颜色噪音中解放出来 —— 用 caps wordmark + 字重对比表达，颜色只在 hover/focus 时点亮，不再左侧 stripe 颜色编码。
3. **Local-first justifies opinionation**。这是单用户工具，不需要做「兼容所有人审美」的妥协。我们可以选 vermilion 而不是 navy，可以默认 dark 而不假装中立 —— 用户不喜欢可以 fork。
4. **Keyboard is the primary input**。任何高频操作（finding 编辑、submit、tab 切换）都要有可见的键盘 affordance（`<KbdHint>`），不是只藏在快捷键文档里。
5. **Cards are the lazy answer**。能用排版、节奏、留白、规则线表达的层级关系，不要用 card 包。整个 UI 中不出现 nested cards，单层 card 也尽量避免。

## Accessibility & Inclusion

- 目标 WCAG AA。light / dark 两套 token 中，正文（`--ink-primary`）对画布（`--bg-canvas`）保证 ≥ 4.5:1，meta 文（`--ink-secondary`）保证 ≥ 3:1。
- Severity 的颜色（`--severity-must / should / nit`）只是 *额外信号*；首要载体是 caps wordmark 文字，色弱用户不会丢失信息。
- 所有动效遵守 `prefers-reduced-motion`：sidebar running pulse、drawer transition、hover transition 都在 `@media (prefers-reduced-motion: reduce)` 下退化为 instant。
- 键盘可达：所有交互（编辑 finding、切换 tab、提交 review、关闭 drawer）都有键盘路径；focus ring 用 `--brand` 1.5px outline-offset 2px，不依赖背景色变化。
- 不依赖 hover 才能发现的功能：关键 affordance（如 finding 的「按 e 编辑」）默认半透显示，不是只在 hover 时出现。
