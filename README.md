# better-review

> 本地 PR review 助手：把任意 review agent CLI（默认 `claude`，可选 `codex`）+ `gh` CLI 串成一条顺手的工作流，并用浏览器 UI 替代终端交互。

`better-review` 不是 IDE 插件，也不是云服务，而是一个跑在你本机的小工具。它启动一个本地 daemon、托管一个 React UI，让你在浏览器里做这些事：

- 用 PR 号或 URL 创建一次 review，由你选择的 agent（claude / codex）在后台跑
- 在 finding 列表里**勾选 / 编辑 / 删除**，旁边直接看 diff 切片
- 一键把选中的 findings 作为 inline comments 提交到 GitHub
- 多 PR 并行 review，侧栏实时显示每个 session 的状态
- 在主页随时切换 agent，或在 `config.json` 里改默认 agent

---

## 目录

- [better-review](#better-review)
  - [目录](#目录)
  - [适用场景](#适用场景)
  - [前置条件](#前置条件)
  - [安装](#安装)
    - [方式一：从源码全局安装（当前推荐）](#方式一从源码全局安装当前推荐)
    - [方式二：仅本地试用（不全局安装）](#方式二仅本地试用不全局安装)
  - [快速开始](#快速开始)
  - [使用教程](#使用教程)
    - [1. 启动 daemon 与打开 UI](#1-启动-daemon-与打开-ui)
    - [2. 创建一次 review](#2-创建一次-review)
    - [3. 处理 findings](#3-处理-findings)
    - [4. 编辑 review prompt](#4-编辑-review-prompt)
    - [5. 提交到 GitHub](#5-提交到-github)
    - [6. Rerun 与多 PR 并行](#6-rerun-与多-pr-并行)
    - [7. 停止 daemon](#7-停止-daemon)
  - [CLI 参考](#cli-参考)
  - [配置](#配置)
  - [Prompt 三级覆盖](#prompt-三级覆盖)
  - [项目结构](#项目结构)
  - [开发](#开发)
  - [常见问题](#常见问题)
  - [License](#license)

---

## 适用场景

适合：

- 个人在本机审 GitHub PR，希望比终端里直接跑 `claude` / `codex` 更顺手
- 想在 claude 与 codex 之间快速切换，对比同一个 PR 的不同 review 角度
- 想在提交 review 前手工微调措辞、严重度、suggestion
- 同时跟进多个 PR，需要一眼看到各自状态

不适合：

- 团队协作 / 多用户共享 review 状态（这是个本地单用户工具）
- 想替换 review agent 内部的提示词逻辑——review 规则仍由 prompt 决定
- 想绕过 `gh` 直接走 GitHub API：所有 GitHub 操作都委托 `gh` CLI

---

## 前置条件

| 工具                               | 版本                      | 说明                                                                                                                                 |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js                            | ≥ 20                      | daemon 与构建都需要                                                                                                                  |
| [`gh` CLI](https://cli.github.com) | 任何近期版本              | 需要先 `gh auth login` 完成登录                                                                                                      |
| Review agent CLI                   | 至少装一个                | [`claude`](https://docs.anthropic.com/en/docs/claude-code) 或 [`codex`](https://github.com/openai/codex)；安装后必须能在 PATH 里找到 |
| 浏览器                             | Chrome / Firefox / Safari | UI 跑在 `http://127.0.0.1:<port>`                                                                                                    |

> 默认 agent 是 `claude`；想用 codex 就把 `defaultAgent` 改成 `"codex"`，或在主页表单里临时切换。两个都装上时可以并存切换。

校验：

```bash
node --version           # v20+
gh auth status           # Logged in to github.com
claude --version         # 任意版本（如果用 claude）
codex --version          # 任意版本（如果用 codex）
```

---

## 安装

### 方式一：从源码全局安装（当前推荐）

```bash
git clone <repo-url> better-review
cd better-review
pnpm install
pnpm run build
npm install -g .
```

如果你希望全程使用 pnpm，也可以在项目目录执行：`pnpm link --global`。

装完后 `better-review` 命令应该全局可用：

```bash
which better-review       # /usr/local/bin/better-review 之类
better-review --help
```

### 方式二：仅本地试用（不全局安装）

```bash
git clone <repo-url> better-review
cd better-review
pnpm install
pnpm run build
node dist/cli/index.js --help
```

后续所有 `better-review …` 命令都可以替换成 `node dist/cli/index.js …`。

---

## 快速开始

```bash
# 1. 一键启动：拉起 daemon + 打开浏览器
better-review

# 2. 直接拉起对某个 PR 的 review（同时打开 UI）
better-review owner/repo#123

# 3. 看看 daemon 状态
better-review status

# 4. 关掉 daemon
better-review stop

# 5. 重启 daemon（升级后让新代码生效）
better-review restart
```

第一次跑会在 `~/.better-review/` 下建一个工作目录（详见 [配置](#配置)）。

---

## 使用教程

### 1. 启动 daemon 与打开 UI

```bash
better-review
```

发生了什么：

1. CLI 检查 `~/.better-review/server.json`
   - 如果文件存在且 `/api/health` 通，复用现有 daemon
   - 否则 spawn 一个 detached node 进程跑 `dist/server/index.js`，等它写出 `server.json`
2. 浏览器自动打开 `http://127.0.0.1:<port>/`
3. UI 顶部 banner 会显示**默认 agent** 是否找得到、`gh` 是否已登录；非默认 agent 找不到不会报红，主页 selector 会把它置灰

> 如果 banner 显示 `gh: not authenticated`，先在终端跑 `gh auth login`，然后刷新浏览器。
> 如果 banner 显示 `default agent ...not found`，要么装上对应 CLI，要么把 `defaultAgent` 切到已安装的 agent。

### 2. 创建一次 review

两种方式：

**A. 在浏览器主页输入框里填**

PR 输入支持三种格式：

| 格式                        | 例子                                  |
| --------------------------- | ------------------------------------- |
| 纯数字（用当前 git remote） | `123`                                 |
| `owner/repo#N`              | `acme/web#42`                         |
| 完整 URL                    | `https://github.com/acme/web/pull/42` |

回车或点 **Start review**。输入框下方有一行 segmented agent selector，本次 review 用哪个 agent 在这里选；不点就用 `defaultAgent`，刷新页面会重置回默认。

**B. 命令行直接传**

```bash
better-review owner/repo#123
```

这会同时打开 UI 并在后台创建好 session。

**期间 daemon 在做什么**

```
gh pr view  → PRMeta（标题/作者/分支）
gh pr diff  → 写到 <workdir>/diff.cache
prompt 渲染 → 通过 ReviewAgent 抽象 spawn 选定的 agent 进程
              · claude: claude --output-format stream-json -p <prompt>
              · codex : codex exec --sandbox workspace-write --skip-git-repo-check（prompt 走 stdin）
              ↓ 监听 stdout 进度事件 / 行（heartbeat）
              ↓ chokidar 监听 <workdir>/findings.json
              ↓ 增量解析 + 入库 + SSE 推送
agent exit  → session.status = ready
```

UI 侧栏会实时显示 session 从 `running` → `ready` 的状态变化。

### 3. 处理 findings

进入 PR 详情页后，每条 finding 是一张卡片，包含：

- **左上**：勾选框（决定提交时是否包含）+ 严重度标签 `[MUST]` / `[SHOULD]` / `[NIT]`
- **标题**：一行摘要
- **正文**：markdown，会渲染高亮代码
- **diff 切片**：如果 finding 有 `file:line`，会自动展开 ±5 行的 diff，可以点 "Expand" 看更多
- **右上**：三个按钮
  - 铅笔（编辑）：把卡片变成可编辑表单。改 title / body / severity / suggestion，`⌘↵` 保存
  - 垃圾桶（删除）：从这条 review 中移除（仅本地软删除，不影响 GitHub）

跨文件的 finding（`file=null`）不会有 inline 切片，会在列表顶部的 "PR-wide" 分组里。

> Tip：编辑后卡片标记为 `edited`；多个 tab 同时打开时，编辑会通过 SSE `finding-updated` 事件实时同步到其他 tab。

### 4. 编辑 review 规则

侧栏底部点 **Prompt** 进入编辑器。prompt 拆成两段：

- **Framework**（不可改）：persona、占位符位置、`severity` 枚举、Output 格式、`suggestion` 锚定语义。这些是 `findings-parser` / `submit` 链路的硬契约，包内自带，无法覆盖。
- **Rules**（可三层覆盖）：review checklist 类目、`category` 标签集合、领域规范。你写的 `review.md` 替换的就是这一段。

四个 tab：

| Tab       | 文件路径                         | 用途                                                      |
| --------- | -------------------------------- | --------------------------------------------------------- |
| Effective | （只读）                         | 当前生效的 rules（project → global → builtin 第一个命中） |
| Framework | （只读，包内自带）               | 不可变的工作流框架；只能查看，了解 rules 嵌入位置         |
| Project   | `<cwd>/.better-review/review.md` | 当前 git 项目专属规则（最高优先级）                       |
| Global    | `~/.better-review/review.md`     | 你跨项目复用的规则                                        |

行为：

- 在 Project / Global tab 里修改后点 **Save** 写文件，**Reset** 删除文件回退到下一级
- 切到 Effective tab 可以核对当前到底用的是哪个 scope（右上 `Source: project override / global override / builtin rules` 标签）
- 修改 rules 不会自动重跑已有 review；要让旧 PR 用新规则，得在该 PR 详情页点 **Rerun**，或者在 Project / Global tab 顶部点 **Apply to current session**

> ⚠️ **从 v0.1.x 升级**：早期版本的 `review.md` 是**整体覆盖**整个 prompt（含 `{{DIFF}}` `{{FINDINGS_PATH}}` 等占位符）。从 v0.2 起 `review.md` 仅替换规则段。如果你的旧文件里还残留 `{{DIFF}}` 等占位符，建议手工清掉（占位符仍会被渲染替换，但 diff / 路径会重复出现，效果不理想）。

### 5. 提交到 GitHub

PR 详情页右上角 **Submit** 按钮（数字是当前选中的 finding 数）打开抽屉，4 步：

1. **Review**：列出哪些 finding 会变成 inline comments、哪些会降级到 review body（line 不在 diff 内、或 `file=null`）。降级条目会有黄色提示。
2. **Body**：可以在 review body 顶部写一段开场白（可选）
3. **Event**：选 `COMMENT` / `REQUEST_CHANGES` / `APPROVE`
4. **Confirm**：点 **Confirm**，daemon 拼好 payload → `gh api repos/<owner>/<repo>/pulls/<n>/reviews -X POST` → 返回 GitHub URL

提交成功后：

- 抽屉显示一个跳转链接（直接到 GitHub 上的 review 页）
- 如果有降级条目，抽屉会再次列出哪些被丢到了 body
- session 状态变成 `submitted`，但 finding 仍然可以继续编辑——下一次提交是新的一条 review，不影响已提交的那条

> **不会重试**：如果 `gh api` 返回 4xx/5xx，错误透传到 banner，submissions 表会记一行 `error`，session 不会自动重提。

### 6. Rerun 与多 PR 并行

**Rerun**：在 PR 详情页点 **Rerun** 会：

- 把当前所有活跃 finding 标记为 `archived`（不删，只是从默认视图隐藏）
- 用**当前生效的 prompt** 重跑——这是 rerun 的语义，也就是说改完 prompt 想让旧 PR 也用，就 rerun 它
- 创建新的 workdir 目录 `pr-…-rerun-<ts>/`

**多 PR 并行**：直接在不同 tab / 在主页连续创建即可。daemon 内部用一个并发队列（默认 4 个并行 agent 进程，见 [配置](#配置)），多余的会排队。每条 session 自带一个 agent 字段，互不干扰。侧栏实时显示每个 session 的状态。

### 7. 停止 daemon

三种方式都可以：

```bash
better-review stop        # 优雅关闭：发 SIGTERM，daemon 自己清理 server.json
killall node              # 暴力（谨慎，会杀其他 node 进程）
# 或者：什么都不做，4 小时无活动后自动 idle shutdown
```

> "活动"指任何 HTTP 请求或引擎事件——只要你浏览器开着、UI 在轮询，daemon 就不会被 idle 掉。

---

## CLI 参考

```
Usage: better-review [options] [command] [pr]

Arguments:
  pr           PR 目标：数字、owner/repo#N、或完整 URL

Commands:
  stop         停掉正在运行的 daemon
  status       输出 daemon 状态（pid / port / startedAt）
  restart      重启 daemon（升级后让新代码生效）

Options:
  -h, --help   帮助
```

例：

```bash
better-review                                       # 起 daemon + 开主页
better-review acme/web#42                           # 起 daemon + 创建 review + 跳到 PR 页
better-review https://github.com/acme/web/pull/42   # 同上，URL 形式
better-review status                                # pid=12345 port=51234 startedAt=2026-04-28T…
better-review stop                                  # 关掉
better-review restart                               # 重启
```

---

## 配置

所有状态都在 `~/.better-review/` 下（用 `BETTER_REVIEW_HOME` 环境变量可以改路径）：

```
~/.better-review/
  config.json        # 可选；不存在用默认值
  server.json        # daemon 写的运行时元数据：{ pid, port, startedAt }
  state.db           # SQLite：sessions / findings / submissions（含 agent 字段）
  daemon.log         # 后端结构化日志
  review.md          # 全局 review 规则（global scope）
  sessions/          # 每条 review 的工作目录
    pr-<owner>-<repo>-<n>-<short-id>/
      diff.cache     # gh pr diff 的缓存
      findings.json  # agent 写的 findings
      agent.log      # 选定 agent 的 stdout/stderr 日志
      prompt.txt     # 实际投喂给 agent 的 prompt
```

`config.json` 可改的字段（全部有默认值）：

| 字段                   | 默认        | 说明                                                                    |
| ---------------------- | ----------- | ----------------------------------------------------------------------- |
| `port`                 | `0`（随机） | 想固定端口就设非 0                                                      |
| `idleShutdownMinutes`  | `240`       | 多久无活动后自动退出（分钟）                                            |
| `maxConcurrentReviews` | `4`         | 同时跑的 agent 进程上限                                                 |
| `stallMinutes`         | `3`         | agent 多久没动静（无 stdout）就 watchdog 杀掉                           |
| `defaultAgent`         | `"claude"`  | 创建 session 时未指定 agent 时使用的默认值；可选 `"claude"` / `"codex"` |
| `perPRGCDays`          | `7`         | 老的 session 工作目录留多久（v1 暂不自动 GC）                           |

> ⚠️ **从旧版升级**：`claudeStallMinutes` 仍然可识别，会被读成 `stallMinutes`，但 daemon.log 会打 deprecation warning。建议把 key 改成 `stallMinutes`。

例：

```json
{
  "port": 5555,
  "maxConcurrentReviews": 2,
  "stallMinutes": 5,
  "defaultAgent": "codex"
}
```

---

## Prompt：framework + rules 分层

最终发给 claude 的 prompt 由两段拼成：

```
prompts/framework.md   # 不可变（包内自带）：persona / 占位符位置 / 输出格式 / suggestion 语义
                       # 内含 {{RULES}} 占位符，rules 段会注入到这里
prompts/builtin-rules.md  # 默认 rules：8 类 review checklist + Category labels
```

只有 **rules** 段可以三层覆盖（第一个命中的就用，不合并）：

```
1. <cwd>/.better-review/review.md     # project，仅当 daemon 是从该项目启动时
2. ~/.better-review/review.md         # global
3. prompts/builtin-rules.md           # 内置（包内自带）
```

框架里有 5 个占位符，daemon 在 spawn agent 前替换：

| 占位符              | 内容                                                          |
| ------------------- | ------------------------------------------------------------- |
| `{{RULES}}`         | resolver 解析出的 rules 段（project / global / builtin 之一） |
| `{{PR_META}}`       | PR 标题 / 作者 / URL / body                                   |
| `{{DIFF}}`          | `gh pr diff` 完整结果                                         |
| `{{FINDINGS_PATH}}` | agent 应该把 findings JSON 写到的绝对路径                     |
| `{{SCHEMA}}`        | findings JSON 的 schema 描述                                  |

> 框架里的措辞是 agent 中性的：要求"使用任何可用的文件写入能力把 JSON 写到 `{{FINDINGS_PATH}}`"。claude 会用 `Write` tool，codex 在 `--sandbox workspace-write` 下直接写文件，两边都能落地。

替换顺序：`{{RULES}}` 先，剩余四个后——所以即使你的 `review.md` 里写了 `{{DIFF}}` 等旧占位符，也会被消解（不会以字面量形式漏出）。

框架模板见 [`prompts/framework.md`](prompts/framework.md)，默认 rules 见 [`prompts/builtin-rules.md`](prompts/builtin-rules.md)。

---

## 项目结构

```
better-review/
  src/
    cli/                  # commander 入口 + daemon-launcher（健康探活 / spawn）
    server/
      index.ts            # daemon 主进程：wire deps + 监听端口
      start-session.ts    # 创建 session 的 orchestrator
      api/                # Hono 路由 + 中间件（origin guard / activity 计时）
      engine/             # agent 子进程管理、findings 解析、提交流程
        agent/            # ReviewAgent 抽象 + claude / codex provider 实现
      github/             # gh CLI 包装 + PR target 解析
      db/                 # better-sqlite3 + migrations
      prompts/            # 三级 resolver + 渲染器 + 文件 store
    web/                  # React + Vite，构建到 dist/web
    shared/               # 前后端共享 zod schema 与类型
  prompts/
    framework.md         # 不可变的工作流框架（含 {{RULES}} 占位符）
    builtin-rules.md     # 默认 review 规则（8 类 checklist + category 标签）
  scripts/copy-assets.mjs # 构建后处理：拷贝 migrations + 给 CLI 加 +x + 修 ESM 导入扩展名
  tests/
    server/               # vitest（路由 + 引擎 + DB）
    web/                  # vitest + jsdom（组件）
    cli/                  # vitest（daemon launcher）
    e2e/                  # Playwright happy path
    fixtures/             # fake-claude.sh / fake-gh.sh
  docs/
    superpowers/specs/    # 设计文档
    superpowers/plans/    # 实施计划
    qa/                   # QA 验收报告
```

---

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式：分别起 daemon（tsx watch） 和 vite dev server
pnpm run dev:server    # 终端 1：tsx watch src/server/index.ts
pnpm run dev:web       # 终端 2：vite dev server，代理到 daemon

# 测试
pnpm run test          # vitest，server / cli 测试，约 100+ 用例
pnpm run test:web      # vitest jsdom，前端组件测试
pnpm run e2e           # Playwright happy path（需要先 pnpm exec playwright install chromium）

# 构建
pnpm run build         # tsc + vite build + scripts/copy-assets.mjs

# 其他
pnpm run lint
pnpm run format
```

测试约定：

- 后端测试用真实的 `better-sqlite3` 打到临时文件，不 mock DB
- agent CLI（claude / codex）和 gh 用 `tests/fixtures/` 里的 shell shim 替身（`fake-claude.sh` / `fake-codex.sh` / `fake-gh.sh`），跑得快
- runner 测试通过 `describe.each` 同时覆盖每个 provider
- 改路由先写失败测试，再实现，再 commit；Conventional Commits

---

## 常见问题

**Q: 浏览器打不开 / 提示端口被占？**
A: `better-review --status` 看 daemon 端口；`config.json` 里 `port` 留 `0` 让 OS 随机分配能避免冲突。

**Q: UI 一直显示 "Loading diff…"？**
A: 确认 PR 详情页的 session 状态已经到 `ready`；diff 是从 daemon 的 `<workdir>/diff.cache` 读的，daemon 启动 review 时会写。

**Q: agent 跑很久不结束？**
A: 默认 3 分钟无 stdout 输出就 watchdog 杀。可以在 `config.json` 调大 `stallMinutes`（旧名 `claudeStallMinutes` 仍兼容）。被杀后 session 状态变 `failed`，可以点 Rerun。

**Q: 怎么换 agent？**
A: 主页输入框下方有 `claude` / `codex` 选择按钮，本次 review 用谁就点谁；想永久切默认就改 `~/.better-review/config.json` 里的 `defaultAgent`。codex 默认会带 `--sandbox workspace-write` 启动，prompt 通过 stdin 喂入，所以非常长的 diff 也不会触发 argv 长度限制。

**Q: `gh` 命令找得到，但 daemon 显示 "not authenticated"？**
A: daemon 用的是子进程，环境变量沿用启动 daemon 时的 shell。重新登录 (`gh auth login`) 后请重启 daemon (`better-review --stop && better-review`)。

**Q: 我改了 prompt，旧的 PR 还会用旧的吗？**
A: 是的。已生成的 finding 不会自动重新审。要让某条 PR 用新 prompt，去它的详情页点 **Rerun**。

**Q: 多设备 / 多用户同时审同一个 PR？**
A: 不支持。daemon 是本地单用户的；每台机器独立维护自己的 session 和 submissions。

**Q: 我想绕过 `gh` 用 token 直连 GitHub？**
A: 不在 v1 范围。所有 GitHub 操作都走 `gh` CLI，因为这样能复用你已有的 `gh auth` 凭证、企业 SSO、SAML 等设置。

---

## License

待补。
