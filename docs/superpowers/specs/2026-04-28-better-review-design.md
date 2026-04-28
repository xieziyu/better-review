# better-review · 设计文档

**日期**: 2026-04-28
**状态**: Draft，待实现计划

---

## 1. 目标与定位

`better-review` 是一个本地工具，把 `claude` CLI 加 `gh` CLI 组合成一条更顺手的 GitHub PR review 流程，并用浏览器 UI 替代终端交互。它不是 IDE 插件、不是云服务、不是团队协作工具，而是个人本地开发助手。

**v1 核心目标（解决三个痛点）**：

1. **finding 选择 UX**：用列表勾选替代输入 `R1, R3, R5-R7`
2. **代码上下文可见**：finding 旁直接看 diff 切片，不必跳 GitHub
3. **提交前可编辑 finding**：措辞、严重度、代码片段都能在 UI 里改

支持**多 PR 并行**：同时 review 多个 PR，侧栏可一眼看每个 PR 的状态。

## 2. 非目标（Non-goals）

- 不替换 `claude` 自身的提示词逻辑：review 规则仍由 prompt 模板定义
- 不直接调用 GitHub REST/GraphQL：所有 GitHub 操作走 `gh` CLI
- 不做团队协作 / 多用户 / 远程部署
- 不做 IDE 集成（VSCode 插件等）
- 不做 review 报告导出到 Obsidian / Notion / Slack
- 不内置 PR 浏览/筛选功能：用户已经有 GitHub UI 做这件事

## 3. 用户旅程

主要场景：**daemon 已启动，UI 是入口**。

```
1. 首次：用户跑 `better-review` → CLI fork daemon → 打开浏览器到首页
2. 之后：浏览器一直开着；用户在 UI 里点 "+ New PR" 输 PR# → review 开始
3. claude review 跑（约 1–5 分钟），UI 实时显示进度（streaming）
4. 完成后 finding 列表 + diff 切片渲染出来，用户：
   - 勾选要提交的 finding（默认全选）
   - 双击 finding 卡片 → 编辑 markdown / 改 severity / 改 suggestion
   - 点 "Submit" → 选 event 类型（COMMENT / REQUEST_CHANGES / APPROVE）→ 确认
5. 提交完成，UI 显示 GitHub review URL；session 状态变 submitted
6. 用户切到下一个 PR 继续，或关浏览器（daemon 仍跑）
```

CLI 子命令仅作辅助：

- `better-review` —— 启动 daemon（如未启），打开浏览器
- `better-review <PR>` —— 同上 + 直接创建 session 跳到该 PR
- `better-review --stop` —— 优雅关闭
- `better-review --status` —— 显示 daemon pid/port/启动时间

## 4. 高层架构

```
┌──────────────┐   ┌──────────────────┐
│  CLI (薄壳)  │   │  Browser (React) │
│  better-review│   │  Sidebar + Main │
└───────┬──────┘   └────────┬─────────┘
        │ fork / open       │ HTTP + SSE
        └─────────┬─────────┘
                  ▼
        ┌─────────────────────────────────────┐
        │  Daemon (单 Node 进程，Hono)         │
        │  ┌─────────┐ ┌─────────┐ ┌────────┐ │
        │  │HTTP/SSE │ │ Engine  │ │GH      │ │
        │  │  REST   │ │ spawn   │ │Client  │ │
        │  │  Stream │ │ claude  │ │(gh CLI)│ │
        │  └─────────┘ └─────────┘ └────────┘ │
        │  ┌─────────────────┐ ┌────────────┐ │
        │  │ SQLite (state)  │ │ Per-PR FS  │ │
        │  └─────────────────┘ └────────────┘ │
        └─────────────────────────────────────┘
                  │ child_process
                  ▼
        ┌──────────┐  ┌──────────┐
        │claude CLI│  │  gh CLI  │
        └──────────┘  └──────────┘
```

**关键决策**：

- **单进程 daemon**：HTTP 层 + 引擎 + DB 都在一个 Node 进程里，子进程仅 claude 和 gh
- **claude 写 findings.json**：用 prompt 指示 claude 用 Write 工具产 JSON，比解析 stdout 稳
- **gh CLI 全程使用**：用户的 `gh auth` 即所需凭证，不另接 OAuth
- **SSE 单向推送 + REST 动作**：不上 WebSocket
- **SQLite 全局状态 + per-PR 文件目录**：DB 存索引/元数据，文件目录存大块产物（findings.json、claude.log、diff.cache）

## 5. 技术栈

| 层        | 选型                                 | 理由                           |
| --------- | ------------------------------------ | ------------------------------ |
| 运行时    | Node.js LTS (≥20)                    | 最广装；CLI/server 都顺手      |
| 语言      | TypeScript                           | 强类型，前后端共享 schema      |
| 后端框架  | Hono                                 | 极小依赖，HTTP + SSE 一把梭    |
| DB        | better-sqlite3                       | 同步 API，零外部进程           |
| 前端      | React + Vite + TypeScript            | 生态最大；diff/markdown 包齐全 |
| 样式      | Tailwind + shadcn/ui                 | 默认视觉正，写得快             |
| Diff 渲染 | react-diff-view + shiki              | 切片 + 语法高亮                |
| Markdown  | react-markdown + rehype-highlight    | finding 内容渲染               |
| 状态管理  | TanStack Query + 自写 SSE hook       | 无 Redux                       |
| 测试      | vitest + supertest + Playwright      | 轻量、生态成熟                 |
| 包结构    | 单 package（无 monorepo workspaces） | 内部组织用目录足够             |

**项目结构**：

```
better-review/
  src/
    cli/              # CLI 入口（commander）
    server/
      index.ts        # daemon 主进程
      engine/         # claude 子进程管理 + findings 解析
      github/         # gh CLI 包装
      db/             # better-sqlite3 + migrations
      api/            # REST + SSE 路由
      prompts/        # 模板解析与三级覆盖
    web/              # React app，构建到 dist/web
    shared/           # 前后端共享类型（Finding、PRSession、API schema）
  prompts/
    builtin.md        # 内置默认 review 提示词
  docs/superpowers/specs/
  package.json        # 单包；bin: { "better-review": "dist/cli/index.js" }
```

打包发布：`npm i -g better-review` 装 CLI；前端产物随包发，daemon 启动时直接 serve `dist/web`。

## 6. 组件细节

### 6.1 CLI (`src/cli`)

只做四件事：

1. 解析参数（commander）
2. 读 `~/.better-review/server.json` 检测现有 daemon
3. 必要时 `child_process.spawn` 一个 detached daemon 进程，poll `/api/health` 直到 ready
4. 构造目标 URL（首页 / 特定 PR），调用 `open` 打开浏览器

启动 daemon 失败时（端口/权限/依赖缺失）打印诊断信息，CLI 非 0 退出。

### 6.2 Daemon HTTP API

REST：

```
GET    /api/sessions                      列出所有 PR session（侧栏数据）
POST   /api/sessions                      创建 session，body: { prInput }
GET    /api/sessions/:id                  session 详情 + 全量 findings
DELETE /api/sessions/:id                  删除 session（不撤回已提交 review）
POST   /api/sessions/:id/rerun            重跑 review

PATCH  /api/findings/:id                  编辑 finding (severity/title/body/suggestion)
DELETE /api/findings/:id                  删除单个 finding
PATCH  /api/findings/:id/select           勾选/取消, body: { selected: bool }

POST   /api/sessions/:id/submit           提交到 GitHub
                                           body: { event, body? }

GET    /api/prompts                       当前生效 prompt + 来源
PUT    /api/prompts/:scope                保存到 global|project|cwd
DELETE /api/prompts/:scope                重置回上一级

GET    /api/health                        liveness（CLI 用来探活）
```

SSE：

```
GET    /api/sessions/:id/events           单 PR 事件流
GET    /api/events                        全局事件流（侧栏用）
```

事件类型：`progress` · `finding-added` · `finding-updated` · `status-changed` · `error` · `done`。

### 6.3 Review Engine (`src/server/engine`)

收到 `POST /api/sessions` 后的处理：

1. 解析 PR target（接受 `123` / `owner/repo#123` / GitHub URL）
2. `gh pr view --json number,title,author,body,url,baseRefName,headRefName` 拿元数据
3. `gh pr diff` 拿 unified diff，缓存到工作目录 `diff.cache`
4. 同 `(owner, repo, number, status≠archived)` 已存在 session？→ 返回现有 id（去重）
5. INSERT pr_sessions（status=running）+ 建工作目录 `~/.better-review/pr-<owner>-<repo>-<num>/`
6. 渲染 prompt 模板（注入 PR meta + diff + findings.json 路径 + JSON schema）→ 写 `prompt.txt`
7. spawn `claude --output-format stream-json -p "$(cat prompt.txt)"`，stdout 实时解析 stream-json：
   - 每个 `tool_use` 事件 → 推 SSE `progress`
   - 整个进程的 stdout/stderr 同步落 `claude.log`
8. 同时 `chokidar` 监听 `findings.json`，落盘后增量解析 → INSERT findings → 推 SSE `finding-added`
9. 进程 exit：
   - `code=0` 且 findings.json 有效 → status=ready，推 SSE `done`
   - 其他 → status=failed，error 字段写原因，推 SSE `error`
10. **看门狗**：N 分钟无 stream-json 事件视为卡死（默认 3 分钟，可配置）→ SIGTERM → SIGKILL

并发限制：`maxConcurrentReviews=4`（可配置）；超出时新 session 进 `pending` 队列。

### 6.4 GitHub Client (`src/server/github`)

包一层 `gh` 子进程，统一捕获 stderr/exit code 抛业务错误：

```ts
gh.prView(target): Promise<PRMeta>
gh.prDiff(target): Promise<{ files: ChangedFile[]; unifiedDiff: string }>
gh.submitReview(target, payload): Promise<{ html_url: string; id: number }>
gh.authStatus(): Promise<boolean>
```

启动 daemon 时跑一次 `which claude && which gh && gh auth status`，结果写到 `/api/health`，UI 侧栏顶部红条提示缺失项。

### 6.5 SQLite Schema

用 `better-sqlite3`，WAL mode：

```sql
CREATE TABLE pr_sessions (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  repo        TEXT NOT NULL,
  number      INTEGER NOT NULL,
  title       TEXT,
  author      TEXT,
  url         TEXT,
  base_ref    TEXT,
  head_ref    TEXT,
  status      TEXT NOT NULL,    -- running|ready|failed|submitted|archived
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  workdir     TEXT NOT NULL,
  prompt_used TEXT NOT NULL,    -- 快照
  error       TEXT
);
CREATE INDEX idx_sessions_status ON pr_sessions(status);
CREATE INDEX idx_sessions_pr ON pr_sessions(owner, repo, number);

CREATE TABLE findings (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pr_sessions(id) ON DELETE CASCADE,
  ord          INTEGER NOT NULL,        -- "R1" 的 1
  severity     TEXT NOT NULL,           -- must|should|nit
  category     TEXT NOT NULL,
  file         TEXT,
  line         INTEGER,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  suggestion   TEXT,
  selected     INTEGER NOT NULL DEFAULT 1,
  edited       INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_findings_session_active ON findings(session_id, archived);

CREATE TABLE submissions (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pr_sessions(id),
  event        TEXT NOT NULL,           -- COMMENT|REQUEST_CHANGES|APPROVE
  github_url   TEXT,
  payload_json TEXT NOT NULL,
  finding_ids  TEXT NOT NULL,            -- JSON array
  submitted_at INTEGER NOT NULL,
  error        TEXT
);
```

启动时跑简单 migration（version 表 + 顺序 SQL 文件）。

### 6.6 Frontend (`src/web`)

路由（react-router）：

```
/              首页：欢迎 + 输入框 + 历史卡片
/pr/:id        PR 详情：findings + diff + edit + submit
/prompt        prompt 模板编辑器（三个 scope 标签）
/settings      偏好（idle timeout、默认 review event、超时阈值）
```

主要组件：

- `<Sidebar>` —— `/api/sessions` + `/api/events` SSE，状态徽章实时更新
- `<FindingList>` —— 按 file 分组、severity 排序，每条卡片可勾选 / 编辑 / 删除
- `<FindingCard>` —— 标题 / severity 选择器 / markdown 编辑器（textarea + 预览 split）/ "View on GitHub" 链接
- `<DiffViewer>` —— `react-diff-view` + `shiki`，按 finding 的 file:line 切片显示 ±10 行（点击展开完整 hunk）
- `<SubmitDrawer>` —— 选中预览组装好的 GitHub 评论 → 选 event → 提交 → 展示返回 URL
- `<PromptEditor>` —— 三标签页（生效中只读 / 项目级 / 全局），保存写文件 / 重置回上一级 / "应用到当前 session"（即触发 rerun）
- `<HealthBanner>` —— 顶部红条，缺 claude/gh 或 gh 未登录时显示

状态管理：TanStack Query 缓存 REST 数据；自写 `useSSE` hook 接收事件并 invalidate 对应 query。

### 6.7 Prompt 模板系统 (`src/server/prompts`)

```
prompts/builtin.md                       # 仓库内置（pr-review.md 通用部分）

读取优先级（最高优先生效）：
  1. <repo-cwd>/.better-review/review.md   # 项目级
  2. ~/.better-review/review.md            # 全局
  3. prompts/builtin.md                    # 内置兜底

变量：
  {{PR_META}}        PR 标题/作者/body
  {{DIFF}}           完整 unified diff
  {{FINDINGS_PATH}}  工作目录中 findings.json 的绝对路径
  {{SCHEMA}}         finding JSON schema（含示例）
```

模板末尾固定指示 claude：**用 Write 工具把符合 SCHEMA 的 JSON 数组写到 FINDINGS_PATH，不要在 stdout 输出报告**。

UI 编辑器保存即写文件。每次启动 review（首跑或 rerun）都按三级覆盖**重新解析当前生效的 prompt**，并把解析结果作为快照写入 `pr_sessions.prompt_used`。该字段是审计/复现用，不参与下一次 rerun 的 prompt 决策。

## 7. Findings JSON Schema

```ts
type Finding = {
  id: string // "R1", "R2", ... (claude 自己生成)
  severity: 'must' | 'should' | 'nit'
  category: string // "Type Safety" | "Security" | "Naming" | ...
  file: string | null // null 表示跨文件 finding（进 review body）
  line: number | null
  title: string // 一行摘要
  body: string // markdown 详细描述
  suggestion?: string // 代码片段，可选
}

type FindingsFile = Finding[]
```

server 解析 findings.json 时校验 schema；非数组、缺必需字段、severity 取值非法 → session=failed，错误写 `error` 字段。

## 8. 关键流程

### 8.1 启动 review（详见 §6.3）

CLI → daemon → `gh pr view/diff` → spawn claude → 监听 stdout (stream-json) + 监听 findings.json 落盘 → 增量入库 + SSE → claude exit → 状态置 ready。

### 8.2 编辑 finding

UI 卡片双击 → markdown 编辑器 → blur 触发 `PATCH /api/findings/:id` → DB UPDATE + `edited=1` → 全局 SSE 推 `finding-updated` → Query invalidate → 其他 tab 自动同步。无乐观锁，最后写优先；冲突由用户 refresh 处理。

### 8.3 提交到 GitHub

- 取所有 `selected=1 AND archived=0` 的 finding
- 拆分：`file+line` 进 `comments[]`；`file=null` 进 review body
- **server 端再校验 line 是否在 diff 内**：不在则降级到 body，UI 提示降级条目
- 写 `/tmp/payload.json` → `gh api repos/<owner>/<repo>/pulls/<num>/reviews -X POST --input ...`
- 成功：INSERT submissions，session.status=submitted（允许再次提交，仍此态）
- 失败：错误透传到前端 banner，submissions 写一条 error 行（不重试）

### 8.4 Rerun

`POST /api/sessions/:id/rerun`：

- 当前活跃 findings 全部 `archived=1`（保留历史，UI 默认只看活跃；可切到"历史"标签查看）
- 用 **当前生效** 的 prompt（不是快照）—— rerun 的语义就是用最新规则
- 新建工作目录 `pr-...-rerun-<ts>/`，旧目录保留
- session 重新走 running → ready

### 8.5 已提交后再次编辑/再次提交

- 提交后 finding 仍允许编辑（不影响已提交版本，下次提交才生效）
- session 状态保持 submitted，UI 显示"已提交 N 次"
- 再次提交时同 §8.3，新建一条 submissions 行

## 9. 错误处理

| 类别                      | 触发                       | 处理                | 用户感知                 |
| ------------------------- | -------------------------- | ------------------- | ------------------------ |
| 环境缺失                  | `claude` / `gh` 不在 PATH  | 启动时检测          | 顶部红 banner            |
| gh 未登录                 | `gh auth status` 非 0      | 创建 session 前预检 | 弹层提示 `gh auth login` |
| PR 不存在/无权            | `gh pr view` 404/403       | session=failed      | 卡片显示 stderr + Retry  |
| claude 进程崩溃           | exit ≠ 0                   | claude.log 落盘     | 折叠面板看 log 末尾      |
| claude 卡死               | N 分钟无 stream-json 事件  | SIGTERM → SIGKILL   | "review 卡住" + Retry    |
| findings.json 缺失/格式错 | 文件没写或 JSON.parse 失败 | session=failed      | 显示原始 log             |
| 提交时 line 不在 diff     | server 提交前校验          | 降级到 body         | 蓝色提示降级条目         |
| gh API 422/401/403        | 提交失败                   | 不自动重试          | 红 banner，原始错误      |
| 端口冲突                  | EADDRINUSE                 | +1 寻找可用端口     | 透明（CLI 等新端口监听） |
| stale daemon              | server.json 在但进程死     | 删旧文件，重新 fork | 透明                     |

**配置项**（`~/.better-review/config.json`）：

```jsonc
{
  "port": 0, // 0 = 自动分配
  "idleShutdownMinutes": 240, // 4 小时
  "maxConcurrentReviews": 4,
  "claudeStallMinutes": 3, // N 分钟无事件视为卡死
  "perPRGCDays": 7, // 删 session 后保留 7 天文件再 GC
}
```

**数据安全**：

- SQLite WAL，崩溃不丢已提交事务
- per-PR 工作目录在 session 删除时不级联删，7 天后 GC
- daemon SIGTERM 时：广播 SSE `shutting-down`、kill 所有 claude 子进程、关 DB、删 server.json

## 10. 测试策略

**单元（vitest）**：

- prompt-resolver（三级覆盖、变量替换）
- findings-parser（异常 JSON）
- gh-client（mock spawn，测异常码）
- submit-payload-builder（comments[] 与 body 划分、line 越界降级）

**集成（vitest + supertest）**：

- `POST /api/sessions` → fake claude 脚本写 findings.json → 验 SSE 序列 + DB
- 提交流程 → mock gh API → 验 payload 结构
- daemon 启停、stale server.json 恢复
- rerun（archive 旧、新 finding 入库）

**E2E（Playwright，最少量）**：

- 真实启动 daemon → fixture PR → review 完成 → 勾两个 finding → 提交 → 拦截 gh 调用断言 payload
- 编辑 finding 跨 tab 实时同步
- failed session 显示错误 + Retry

不引入 mock-claude 可执行；测试用 shell 脚本顶替 claude（写好 findings.json 即可）。

## 11. 安全边界

- daemon 仅监听 127.0.0.1，不绑 0.0.0.0
- Origin 检查：浏览器 Origin 必须是 `http://127.0.0.1:<port>` 或 `http://localhost:<port>`
- 无认证（本机单用户工具，没必要）
- 不持久化任何 token/密钥；GitHub 凭证由 `gh` CLI 管理
- prompt 文件读写仅限 `<cwd>` / `~/` 两个固定路径

## 12. 未来扩展（v2+，非 v1 范围）

- review 历史的搜索 / 全文检索
- finding 的"已修复"追溯（拉 PR 后续 commit 看 finding 涉及行是否变化）
- 多 review 模板（"严苛 review" / "快速过 review" 两种 prompt 切换）
- Tauri 包装成桌面 app
- review 报告导出（markdown / Slack 链接）

## 13. v1 验收标准

- [ ] `npm i -g better-review` 后 `better-review` 命令可用
- [ ] 跑 `better-review` 自动启动 daemon 并打开浏览器
- [ ] 在 UI 输入 PR# → review 完成后看到 ≥1 条 finding
- [ ] 多个 PR 并行 review 互不阻塞，侧栏状态实时更新
- [ ] finding 卡片可勾选 / 编辑 / 删除
- [ ] diff 切片在 finding 旁正常渲染并可展开
- [ ] 提交到 GitHub 成功，能在 PR 页面看到 inline comments
- [ ] line 不在 diff 内的 finding 自动降级到 body 并提示
- [ ] prompt 编辑器三 scope 切换 + 保存生效
- [ ] daemon 闲置 4 小时自动退出
- [ ] daemon 崩溃后下次 CLI 调用自动恢复
