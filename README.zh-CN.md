# better-review

> 本地优先的 PR review 助手。在浏览器 UI 里驱动 `claude` / `codex` review agent，把审查意见通过 `gh` CLI 提交成 GitHub inline comments。

[English](./README.md)

`better-review` 完全跑在你本机：一个 Node daemon、一个 React SPA，加上对 review agent 与 `gh` CLI 的薄封装。没有云端、没有鉴权、没有共享状态——所有数据都在 `~/.better-review/` 下。

## 主要能力

- **浏览器审阅**：每条 finding 都能勾选 / 编辑 / 删除，旁边自动展开对应的 diff 切片。
- **可插拔 agent**：每次 review 自由选 `claude` 或 `codex`，也可以设默认。
- **一键提交 GitHub**：勾选的 findings 走 inline comments，跨文件或 off-diff 的降级到 review body，全部经 `gh api`。
- **多 PR 并行**：侧栏通过 SSE 实时刷新各 session 状态；并发上限可配置。
- **三级 prompt 覆盖**：项目级（`<cwd>/.better-review/review.md`）→ 全局（`~/.better-review/review.md`）→ 内置，第一个命中即生效。
- **状态可见**：sessions / findings / submissions 全部存在本地 SQLite，随时可查。

## 前置条件

| 工具                               | 版本                      | 说明                                                                                                                            |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org)      | ≥ 20                      | daemon 与构建都需要                                                                                                             |
| [`gh` CLI](https://cli.github.com) | 任意近期版本              | 必须先 `gh auth login`                                                                                                          |
| Review agent CLI                   | 至少装一个                | [`claude`](https://docs.anthropic.com/en/docs/claude-code) 和/或 [`codex`](https://github.com/openai/codex)，需在 `PATH` 中可用 |
| 浏览器                             | Chrome / Firefox / Safari | UI 跑在 `http://127.0.0.1:<port>`                                                                                               |

## 安装

目前从源码安装（暂未发布到 npm）：

```bash
git clone https://github.com/xieziyu/better-review.git
cd better-review
pnpm install
pnpm run build
npm install -g .         # 或：pnpm link --global
```

验证：

```bash
better-review --help
```

不想全局安装的话，`pnpm run build` 完成后用 `node dist/cli/index.js …` 替代下文所有 `better-review …` 命令即可。

## 快速开始

```bash
better-review                                       # 拉起 daemon + 打开 UI
better-review https://github.com/owner/repo/pull/1  # 同时创建 review 并跳转
better-review status                                # pid / port / startedAt
better-review stop                                  # 优雅关闭
```

首次运行会创建 `~/.better-review/`（可以用 `BETTER_REVIEW_HOME` 改路径）。

## 使用

### 创建一次 review

主页输入框接受标准 GitHub PR URL（`https://github.com/<owner>/<repo>/pull/<n>`），回车或点 **Start review**。表单下方还有三个可选输入：

- **本地仓库路径**：指向你已有的 clone（如 `~/code/owner/repo`）。daemon 会在 PR head 上挂一份 `git worktree`，让 agent 看到的是合并后的源码而不是只有 diff。URL 命中过历史路径会自动填好。
- **Extra context**：本次 review 专属的 prompt 补充（贴需求文档片段、设计意图、给 agent 的额外指引等），仅作用于这次 review，不会改 `review.md`。
- **Agent** segmented selector：临时覆盖 `defaultAgent`，仅本次有效。

命令行直接传 PR URL 也行——会用默认配置打开 UI 并跳到该 PR。

### 处理 findings

每条 finding 渲染成一张卡片，包含：

- 决定是否提交的勾选框
- 严重度标签（`MUST` / `SHOULD` / `NIT`）
- markdown 正文，若 finding 带 `file:line` 会自动展开 diff 切片
- 编辑 / 删除按钮（`⌘↵` 保存；删除仅本地软删除，不影响 GitHub）

跨文件 finding（无 `file`）会被归到列表顶部的 PR-wide 分组。多 tab 同时打开同一 PR，编辑通过 SSE 实时同步。

### 提交到 GitHub

**Submit** 抽屉分两步：

1. **Review**：预览选中的 finding 哪些走 inline、哪些会降级到 review body（off-diff 或 PR-wide），同页选择 review event（`COMMENT` / `REQUEST_CHANGES` / `APPROVE`）并编辑 review body。Body 会按 PR-wide finding 自动填充，可以手动覆盖。
2. **Confirm**：最终确认页，按下 `⌘⏎` 提交。daemon 会 POST 到 `gh api repos/<owner>/<repo>/pulls/<n>/reviews` 并在抽屉里给出 GitHub URL。

**不会自动重试**，失败会在 banner 和 submissions 表里留痕。

### 自定义 review prompt

Prompt 分两层：

- **Framework**（只读，包内自带）：reviewer persona、占位符位置、**severity rubric**（`must` / `should` / `nit` 的语义）、输出 schema 以及 `suggestion` 的锚定规则。这是 findings parser 和提交链路的硬契约，写 `review.md` 也覆盖不了。
- **Rules**（可覆盖）：review checklist、`category` 标签集合，以及你想让 agent 遵循的任何领域规范。解析顺序如下，第一个命中即生效：

  ```
  <cwd>/.better-review/review.md   # 项目级（路径相对于 daemon 启动时的工作目录）
  ~/.better-review/review.md       # 全局
  prompts/builtin-rules.md         # 内置默认
  ```

在顶栏的 **Prompt** 入口里编辑（`Project` / `Global` 两个 tab，`⌘S` 保存）。保存只影响后续 review。要让已有 session 用上新规则，可以在 prompt 编辑器里点 **Apply to current session**——它会弹一个多选框让你挑哪些 session 重跑——或者去单个 PR 详情页点 **Rerun**。Daemon 配置（默认 agent、watchdog、GC 保留天数等）在顶栏的 **Settings** 入口里改；旁边的**状态点**实时反映 daemon 与 CLI 的健康状况——点开是 pid / port / uptime / agent 与 `gh` 路径的浮层。

## 配置

`~/.better-review/` 下的目录结构：

```
config.json               # 可选；不写就用默认值
server.json               # daemon 运行时元数据：{ pid, port, startedAt }
state.db                  # SQLite — sessions / findings / submissions
daemon.log                # 后端结构化日志
review.md                 # 全局 rule 覆盖（可选）
sessions/pr-<...>/        # 每条 review 的工作目录：diff.cache、findings.json、agent.log、prompt.txt
```

`config.json` 可改字段（全部可选）。**Settings** 页改的就是这个文件，绝大多数字段保存即生效；下表标注 _(需重启)_ 的两项要重启 daemon 才生效。

| 字段                   | 默认        | 说明                                                     |
| ---------------------- | ----------- | -------------------------------------------------------- |
| `port`                 | `0`（随机） | 想要稳定 URL 就固定一个端口 _(需重启)_                   |
| `maxConcurrentReviews` | `4`         | 并行 agent 进程上限，超过的排队 _(需重启)_               |
| `stallMinutes`         | `3`         | agent 多久没 stdout 就触发 watchdog                      |
| `defaultAgent`         | `"claude"`  | 可选 `"claude"` / `"codex"`；UI selector 可单次覆盖      |
| `perPRGCDays`          | `7`         | 超过这么多天的 per-PR 工作目录会被 GC 掉；填 `0` 关闭 GC |

## 开发

```bash
pnpm install
pnpm run dev:server    # tsx watch daemon
pnpm run dev:web       # Vite dev server，代理 /api → daemon
pnpm run build         # tsc + vite build + scripts/copy-assets.mjs
pnpm run test          # vitest（server + cli + shared）
pnpm run test:web      # vitest jsdom（前端组件）
pnpm run e2e           # Playwright happy path
pnpm run lint
pnpm run format        # 写盘；CI 用 format:check
```

### 开发指导原则

- **Conventional Commits**，小写命令式语态——`feat(scope): …`、`fix(scope): …`。沿用现有 scope（`cli`、`server`、`engine`、`web`、`prompts`）。
- **路由与引擎代码 TDD**：先写失败测试，再实现，再提交。
- **不要 mock `better-sqlite3`、agent CLI 或 `gh`**。测试用临时路径上真实的 SQLite 文件，外部工具用 `tests/fixtures/` 下的 shell shim（`fake-claude.sh` / `fake-codex.sh` / `fake-gh.sh`）替代。
- **TypeScript 严格设置**——`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes` 都开了。索引访问要先 narrow，optional 字段必须显式传 `undefined`。
- **TS 源码里的 import 不要写 `.js`**。`scripts/copy-assets.mjs` 会在构建后改写编译产物的扩展名，源码保持 extensionless。
- **Prompt 文案约定**——改 `prompts/builtin-rules.md` 或写 `review.md` 时，自然语言用 简体中文，代码标识符 / 路径 / flag 保持英文。

更深入的架构和设计动机见 [`CLAUDE.md`](./CLAUDE.md)、[`DESIGN.md`](./DESIGN.md)、[`PRODUCT.md`](./PRODUCT.md)。

## 常见问题

**端口被占？** `config.json` 里把 `port` 留 `0` 让 OS 挑一个空闲端口，或者固定端口并先关掉占用它的进程。

**状态点变红、浮层显示 `gh: not authed`。** daemon 继承的是启动 shell 的环境变量。`gh auth login` 后 `better-review restart`。

**agent 跑很久不结束。** 默认 3 分钟无 stdout 就 watchdog 杀；如果你的 review 本来就慢，调大 `stallMinutes`。被杀后 session 状态变 `failed`，点 **Rerun**。

**改了 prompt，已开的 PR 会自动重跑吗？** 不会。已生成的 finding 留在原地；要用新规则就在 PR 详情页点 **Rerun**，或者在 prompt 编辑器里点 **Apply to current session**。

## License

Copyright (C) 2026 xieziyu

better-review 是自由软件，采用 **GNU General Public License v3.0 或更高版本** 授权——详见 [LICENSE](./LICENSE)。
