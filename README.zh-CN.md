# better-review

> 本地优先的 PR review 助手。在浏览器 UI 里驱动 `codex` / `claude` / `pi` review agent，把审查意见通过 `gh` CLI 提交成 GitHub inline comments。

[English](./README.md)

`better-review` 完全跑在你本机：一个 Node daemon、一个 React SPA，加上对 review agent 与 `gh` CLI 的薄封装。没有云端、没有鉴权、没有共享状态——所有数据都在 `~/.better-review/` 下。

<p align="center">
  <img src="./docs/overview.png" alt="better-review 主界面：Files changed tab 与内联 finding 卡片" width="900" />
</p>

## 亮点

- **按 review 选 agent**——`codex` / `claude` / `pi` 在同一个界面里随时切换，不用换工具、不用换工作流。可以设默认，也可以每次单独覆盖。
- **审在飞的工作，不只是已经开了的 PR**——GitHub PR、本地 git 分支，或者 [GitButler](https://gitbutler.com/) 工作区里的某一条虚拟分支，三种来源用同一套 triage UI、同一套 findings shape。本地来源不依赖 `gh`，全程在 UI 内审完即止。
- **agent 看的是真实源码**——挂上本地 clone，agent 拿到的是 PR head 上的 `git worktree`：真实文件、真实调用方，而不是只有 diff。不挂 clone 也能拉到改动文件在 HEAD 时的内容。
- **东西出去之前你说了算**——逐条审 finding，改文案、改严重度，自己加，删掉不重要的。在你按 Submit 之前不会有任何东西落到 GitHub。
- **重跑会接着上一轮**——每次 rerun 自动归档上一轮变成只读历史，并把上一轮的 review（body + inline 评论 + 回帖）反喂给 agent，让它在过往判断之上继续而不是从零开始。
- **两条出口：GitHub 或 coding agent**——一键把选中的 finding 通过 `gh` 提交成 inline comment；或者干脆不走 GitHub，导出 Markdown / JSON 转交给 Claude Code / Codex / Cursor 去修。
- **prompt 按项目定制**——项目级 `review.md` 盖过全局 `review.md` 盖过内置规则，第一个命中即生效，不 fork、不合并。
- **端到端双语**——UI 和 agent 用的 prompt 都同时维护中英两套，findings 也会按你选的语言回来。
- **本地优先、随时可查**——所有数据都在 `~/.better-review/`：SQLite 存状态，prompt / diff / transcript / prep 日志都是平铺文件。没有云端、没有埋点、没有鉴权。

## 前置条件

| 工具                               | 版本                      | 说明                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org)      | ≥ 20                      | daemon 与构建都需要                                                                                                                                                                                                                                         |
| C/C++ 工具链                       | 各平台默认                | 安装时 `better-sqlite3` 会本地构建 native 模块，因此需要：macOS — Xcode Command Line Tools（`xcode-select --install`）；Linux — `build-essential` + `python3`；Windows — `npm install --global windows-build-tools`（或手动装 Visual Studio Build Tools）。 |
| [`gh` CLI](https://cli.github.com) | 任意近期版本              | 必须先 `gh auth login`                                                                                                                                                                                                                                      |
| Review agent CLI                   | 至少装一个                | [`codex`](https://github.com/openai/codex)、[`claude`](https://docs.anthropic.com/en/docs/claude-code) 或 `pi`，需在 `PATH` 中可用                                                                                                                          |
| 浏览器                             | Chrome / Firefox / Safari | UI 跑在 `http://127.0.0.1:<port>`                                                                                                                                                                                                                           |

## 安装

```bash
npm install -g @xieziyu/better-review
```

验证：

```bash
better-review --help
```

想从源码构建（hack 用）：

```bash
git clone https://github.com/xieziyu/better-review.git
cd better-review
pnpm install
pnpm run build
npm install -g .         # 或：pnpm link --global
```

不想全局安装的话，`pnpm run build` 完成后用 `node dist/cli/index.js …` 替代下文所有 `better-review …` 命令即可。

## 快速开始

```bash
better-review                                       # 拉起 daemon + 打开 UI
better-review https://github.com/owner/repo/pull/1  # 同时创建 review 并跳转
better-review status                                # daemon 与 CLI 版本、pid / port
better-review stop                                  # 优雅关闭
better-review restart                               # 停了再起（gh auth login 后常用）
better-review update                                # 升级到最新版本并重启 daemon
better-review --version                             # 打印当前安装的版本号
```

`update` 会重新安装最新发布版本，并根据安装路径自动识别包管理器（npm / pnpm / yarn / bun）——
可用 `--pm <manager>` 显式指定——随后重启正在运行的 daemon，让新版本即时生效。

首次运行会创建 `~/.better-review/`（可以用 `BETTER_REVIEW_HOME` 改路径）。

## 使用

### 创建一次 review

主页顶部有三个 tab，分别对应想要审查的来源：

- **GitHub PR** —— 粘贴标准 GitHub PR URL（`https://github.com/<owner>/<repo>/pull/<n>`），回车或点 **Start review**。
- **Local branch** —— 选择本地 clone（`~/code/owner/repo` 或任意绝对路径），daemon 会以「当前分支 vs base 引用」的 diff 作为 review 范围。默认 head = 当前 `HEAD`，base = 自动（`refs/remotes/origin/HEAD` → `origin/main` → `origin/master`）；表单上可以手动覆盖 head/base。
- **GitButler vbranch** —— 选择由 [GitButler](https://gitbutler.com/) 管理的仓库；daemon 调用 `but status` 列出 workspace 中所有 applied 虚拟分支供你选择。所选 vbranch 的 review base 取该虚拟栈中紧邻其下的分支 tip（确保只审本 vbranch 自己的改动，而不是整条栈）。

每个 tab 都还有以下可选输入：

- **本地仓库路径**（仅 PR tab）：指向你已有的 clone（如 `~/code/owner/repo`）。daemon 会在 PR head 上挂一份 `git worktree`，让 agent 看到的是合并后的源码而不是只有 diff。URL 命中过历史路径会自动填好；支持原生目录选择器的系统上会显示 **Browse** 按钮。不挂本地仓库时，daemon 会通过 `gh api` 抓取 diff 涉及文件在 HEAD 时刻的部分快照。Local branch / GitButler vbranch tab 始终把你选中的路径作为源码树。
- **Extra context**：本次 review 专属的 prompt 补充（贴需求文档片段、设计意图、给 agent 的额外指引等），仅作用于这次 review，不会改 `review.md`。session 详情页可以随时编辑；rerun 默认沿用上一次，可覆盖。
- **Agent** segmented selector：临时覆盖 `defaultAgent`，仅本次有效。CLI 没装的按钮会变灰禁用。

命令行直接传 PR URL 也行——会用默认配置打开 UI 并跳到该 PR。

> Local branch 和 GitButler vbranch session **只读**：finding 可以筛选、编辑、导出，但 **Submit to GitHub** 按钮会隐藏——没有 PR 可以提交。如果想正式发布评审意见，先把分支开成一个 draft PR 再走 PR 流程。

### 处理 findings

PR 详情页有三个 tab —— **Summary**（概览）、**Findings**、**Files changed**。评审完成的 session 默认进入 **Summary**；agent 还在跑时默认进入 **Files changed**，方便边跑边看 diff。

**Summary** tab 是一屏式的评审报告：改动统计、agent 撰写的「这个 PR 做了什么」概览、agent 建议你人工重点审查的文件清单（外加任何含 `must` 级 finding 的文件），以及一张逐文件的**审查覆盖表**——哪些已审查、哪些无问题、哪些需要重点关注、哪些被完全排除在评审之外（依赖锁文件、构建产物、快照等，见 `reviewExcludeGlobs` 配置项）。点击任意文件可直接跳到 **Files changed** 中查看。概览要等 agent 产出；统计和覆盖表是推导出来的，评审中途也会显示。

**Files changed** tab：左侧是路径压缩的层级文件树，右侧是该文件的 unified diff，finding 卡片直接内联渲染在对应 hunk 上。需要逐条审 finding 时切到 **Findings** tab，可配合 Inspector 详情面板。

每条 finding 卡片包含：

- 决定是否提交的勾选框
- 严重度标签（`MUST` / `SHOULD` / `NIT`）和自由文本的 `category`
- markdown 正文，若 finding 带 `file:line` 会自动展开 diff 切片
- 编辑 / 删除按钮（`⌘↵` 保存；删除仅本地软删除，不影响 GitHub）

跨文件 finding（无 `file`）会被归到 PR-wide 分组。在 Files tab 也可以**手动新增 finding**，提交方式与 agent 产生的 finding 一致。agent 还在流式输出时，如果新 finding 落在你当前没在看的文件，会弹一个 toast 提示——点击即可跳转。

多 tab 同时打开同一 PR，编辑通过 SSE 实时同步。

### 重跑 review

每次 rerun 会归档上一轮：当前页面顶部出现 `Round 2` / `Round 3` 等轮次标签，旧的轮次页面（`/session/<old-id>`）仍可访问，但变为只读历史；旧的 `/pr/<id>` 链接会自动重定向到新路径。rerun 同时会把上一轮 review 反馈给 agent——上一轮的 review body、你之前提交的 inline comments、连同 PR conversation thread 都会注入 prompt 的 `PRIOR REVIEW` 段落，让 agent 在过往判断的基础上继续审而不是从零开始。强推会被识别并显式提示。运行中的 review 可以用 **Stop** 按钮取消（先 SIGTERM，超时升级 SIGKILL）。

### 提交到 GitHub

**Submit** 抽屉分两步：

1. **Review**：预览选中的 finding 哪些走 inline、哪些会降级到 review body（off-diff 或 PR-wide），同页选择 review event（`COMMENT` / `REQUEST_CHANGES` / `APPROVE`）并编辑 review body。Body 会按 PR-wide finding 自动填充，可以手动覆盖。与之前 submission 重复的 finding 会被服务端识别并跳过。
2. **Confirm**：最终确认页，按下 `⌘⏎` 提交。daemon 会 POST 到 `gh api repos/<owner>/<repo>/pulls/<n>/reviews` 并在抽屉里给出 GitHub URL。

**不会自动重试**，失败会在 banner 和 submissions 表里留痕。

### 本地导出 findings（转交 coding agent）

不想走 GitHub review 流程，只想把 findings 交给本地 coding agent（Claude Code / Codex / Cursor）做修复？详情页工具栏的 **Export ▾** 按钮（快捷键 `⌘E` / `Ctrl+E`）会弹出一个小面板：

- **Scope**：默认导出已勾选的 findings（与 Submit 一致），可切换到 All（全部未归档 findings）。如果一条都没勾选，会自动切到 All。
- **Format**：`Markdown` 按文件分组、带严重级别 emoji 与 `suggestion` 代码块，适合直接粘贴给 coding agent；`JSON` 是一个干净的 `Finding[]`（剥掉了 dbId / sessionId 等内部字段），适合脚本消费。
- **Copy / Download**：复制到剪贴板或下载文件 `findings-pr-<n>-<scope>.<ext>`。整个过程是纯前端，不调用 `gh`、不写远端、不修改 finding 状态，也不会触发提交。

### 自定义 review prompt

Prompt 分两层：

- **Framework**（只读，包内自带，存在 `prompts/framework.{en,zh-CN}.md`）：reviewer persona、占位符位置、**severity rubric**（`must` / `should` / `nit` 的语义）、输出 schema、`suggestion` 的锚定规则，以及 `{{#SOURCE:…}}` / `{{#EXTRA_NOTES}}` / `{{#PRIOR_REVIEW}}` 三类条件块。这是 findings parser 和提交链路的硬契约，写 `review.md` 也覆盖不了。
- **Rules**（可覆盖，`prompts/builtin-rules.{en,zh-CN}.md`）：review checklist、`category` 标签集合，以及你想让 agent 遵循的任何领域规范。解析顺序如下，第一个命中即生效：

  ```
  <pinned-repo>/.better-review/review.md     # 项目级（路径相对于本次 review 选的本地仓库）
  ~/.better-review/review.md                 # 全局
  prompts/builtin-rules.<lang>.md            # 内置默认，按语言成对
  ```

  项目级 override 只对挂了本地仓库路径的 review 生效；没挂的话直接跳过项目级。

在顶栏的 **Prompt** 入口里编辑（`Effective` / `Framework` / `Project` / `Global` 四个 tab，`⌘S` 保存）。`Project` tab 顶部有仓库选择器——选哪个本地仓库就编辑哪个 `.better-review/review.md`。保存只影响后续 review。要让已有 session 用上新规则，可以在 prompt 编辑器里点 **Apply to current session**——它会弹一个多选框让你挑哪些 session 重跑——或者去单个 PR 详情页点 **Rerun**。

Daemon 配置（语言、默认 agent、watchdog、GC 保留天数、端口、并发等）在顶栏的 **Settings** 入口里改；旁边的**状态点**实时反映 daemon 与 CLI 的健康状况——点开是 pid / port / version / uptime / agent 与 `gh` 路径的浮层。

### 语言

UI 和 agent 用的 prompt 都是中英双语的。顶栏的语言切换器会即时切换 UI 语言，同时决定喂给 agent 的内置 prompt 用哪个变体，findings 也会按这个语言回来。首次启动按 `LANG` / `LC_ALL` / 系统 locale 自动选择。

## 配置

`~/.better-review/` 下的目录结构：

```
config.json               # 可选；不写就用默认值
server.json               # daemon 运行时元数据：{ pid, port, startedAt, version }
state.db                  # SQLite — sessions / findings / submissions / submission_comments
daemon.log                # 后端结构化日志
review.md                 # 全局 rule 覆盖（可选）
codex-home/               # 跑 codex 时用的隔离 CODEX_HOME（下文有说明）
sessions/pr-<...>/        # 每条 review 的工作目录：diff.cache、findings.json、summary.json、agent.log、prompt.txt、prep.log
```

**为什么有 `codex-home/`？** codex CLI 每在新目录里跑一次，都会往它的 `config.toml` 追加一条 `[projects."<cwd>"] trust_level = "trusted"`。better-review 每条 review 都用一个新的 workdir，否则你的 `~/.codex/config.toml` 会因此每条 review 多一段（参考上游 issue openai/codex#14601、#15433）。为此，daemon 给 codex 设了 `CODEX_HOME=~/.better-review/codex-home/`，把这些 trust 写入隔离目录，你真正的 `~/.codex` 不被改动。该目录会从你真实的 `~/.codex/config.toml` 派生（剔除 `[projects.*]` 段）；如果存在 `auth.json` 会做软链，文件认证用户无感切换；macOS keychain 用户无需额外配置。

`config.json` 可改字段（全部可选）。**Settings** 页改的就是这个文件，绝大多数字段保存即生效；下表标注 _(需重启)_ 的两项要重启 daemon 才生效。

| 字段                   | 默认                   | 说明                                                                                                                                         |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`                 | `0`（随机）            | 想要稳定 URL 就固定一个端口 _(需重启)_                                                                                                       |
| `maxConcurrentReviews` | `4`                    | 并行 agent 进程上限，超过的排队 _(需重启)_                                                                                                   |
| `stallMinutes`         | `3`                    | agent 多久没 stdout 就触发 watchdog                                                                                                          |
| `defaultAgent`         | `"codex"`              | 可选 `"codex"` / `"claude"` / `"pi"`；没显式写过这个字段时，若配置的 CLI 没装，会自动回落到已装的第一个                                      |
| `perPRGCDays`          | `7`                    | 超过这么多天的 per-PR 工作目录会被 GC 掉；填 `0` 关闭 GC                                                                                     |
| `language`             | 自动（`en` / `zh-CN`） | UI 和内置 prompt 的语言，首次启动按 `LANG` / `LC_ALL` / 系统 locale 自动选                                                                   |
| `reviewExcludeGlobs`   | `[]`                   | 额外 glob 列表，匹配到的文件会在内置 lockfile / 生成文件默认规则之外，额外从评审 agent 的 prompt 中移除以省 token；不影响 Files Changed 视图 |
| `diffViewMode`         | `"unified"`            | Files Changed 的 diff 布局：`"unified"` / `"split"`。由视图内的切换按钮设置，持久化到这里，daemon 重启后仍保留                               |

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
- **不要 mock `better-sqlite3`、agent CLI 或 `gh`**。测试用临时路径上真实的 SQLite 文件，外部工具用 `tests/fixtures/` 下的 shell shim（`fake-codex.sh` / `fake-claude.sh` / `fake-gh.sh`）替代。
- **TypeScript 严格设置**——`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes` 都开了。索引访问要先 narrow，optional 字段必须显式传 `undefined`。
- **TS 源码里的 import 不要写 `.js`**。`scripts/copy-assets.mjs` 会在构建后改写编译产物的扩展名，源码保持 extensionless。
- **Prompt 文案约定**——每个内置 prompt 都成对存在 `<name>.en.md` 与 `<name>.zh-CN.md` 两份，要同步维护（同样结构、同样的占位符）。中文变体遵循「中文叙述、英文标识符」：文件路径、符号名、CLI flag、`category` 字符串（`Scope`、`Correctness`…）、severity 值（`must` / `should` / `nit`）一律保持英文，它们是数据不是文案。

更深入的架构和设计动机见 [`CLAUDE.md`](./CLAUDE.md)、[`DESIGN.md`](./DESIGN.md)、[`PRODUCT.md`](./PRODUCT.md)。

## 常见问题

**端口被占？** `config.json` 里把 `port` 留 `0` 让 OS 挑一个空闲端口，或者固定端口并先关掉占用它的进程。

**状态点变红、浮层显示 `gh: not authed`。** daemon 继承的是启动 shell 的环境变量。`gh auth login` 后 `better-review restart`。

**agent 跑很久不结束。** 默认 3 分钟无 stdout 就 watchdog 杀；如果你的 review 本来就慢，调大 `stallMinutes`。被杀后 session 状态变 `failed`，点 **Rerun**。

**改了 prompt，已开的 PR 会自动重跑吗？** 不会。已生成的 finding 留在原地；要用新规则就在 PR 详情页点 **Rerun**，或者在 prompt 编辑器里点 **Apply to current session**。

**默认 agent 没装。** 如果你从没在 `config.json` 里显式写过 `defaultAgent`，daemon 会按 `codex` → `claude` → `pi` 的顺序自动回落到已装的第一个；如果你*显式*写过那个值，状态点会变红、主页上对应按钮也会禁用，直到你装上 CLI 或改设置。

## License

Copyright (C) 2026 xieziyu

better-review 是自由软件，采用 **GNU General Public License v3.0 或更高版本** 授权——详见 [LICENSE](./LICENSE)。
