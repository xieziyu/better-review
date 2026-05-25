# Plan: Local-source Review (本地分支 / Worktree / GitButler vbranch)

> Branch: `feat/local-source-review` · 每过一个 Phase 提一组阶段性 commit 到同一分支。
> Created: 2026-05-25 · Update phase checkboxes as work lands.

## 一、目标

把 `better-review` 从"只能 review GitHub PR"扩展到也能 review：

1. **本地 git 分支**（仓库里某个分支 vs 一个 base）
2. **Worktree**（其实就是 #1 的一个特殊路径形式 — 用户指向 worktree 的目录即可）
3. **GitButler 虚拟分支**（在 GitButler 项目里挑选单个 vbranch）

PR 路径保持完全兼容，旧 session 不动。

## 二、锁定的决策

| 维度      | 决定                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Home 输入 | **方案 A — 顶部 Tab**：`GitHub PR / Local branch / GitButler vbranch`；vbranch tab 仅当所选路径是 GitButler 项目时启用，否则灰显并 hint |
| Submit    | **Local/vbranch session 完全禁用 Submit**；按钮 hidden，UI 标记 "Read-only review"；findings 仍可在 UI 内勾选/编辑/查看，但不外发       |
| Diff base | 默认 `merge-base(HEAD, refs/remotes/<default>/HEAD)`，兜底 `origin/main`；UI 可显式覆盖                                                 |
| 路由      | `/pr/:id` 保留为别名；新 session 走 `/session/:id`（Phase 4 收尾时切换）                                                                |
| DB        | 新增 `source_json` 列 + `source_hash` 唯一索引；旧 PR 行 migration 回填；老 PR 字段保留并改 nullable                                    |

## 三、概念建模

```ts
type SessionSource =
  | { kind: 'github-pr'; owner: string; repo: string; number: number }
  | { kind: 'local-branch'; repoPath: string; head: string; base: string }
  | { kind: 'gitbutler-vbranch'; repoPath: string; vbranchName: string; base: string }
```

四个 Provider 接口（`src/server/source/`）：

- `MetadataProvider.fetch(source)` → `{ title, author, headSha, baseRef, headRef, url? }`
- `DiffProvider.fetch(source)` → `{ unifiedDiff, headSha }`
- `SourceTreeProvider.prepare(source, workdir)` → `SourceContext`（沿用现有 `SourceKind`）
- `SubmissionHandler.submit(session, payload)` → `SubmissionResult`（local kind 返回 not-supported）

## 四、阶段与进度

### Phase 0 — SessionSource 类型 + DB 持久化（行为零变化） ✅ done (47d2599)

> Provider 抽象推迟到 Phase 1（有 LocalBranchProvider 这第二个实现时再抽，避免单实现的过度抽象）。

- [x] `src/shared/source.ts`：`SessionSource` 联合 + zod schema + 单测
- [x] `src/server/source/hash.ts`：`sourceHash()` (server-only，避免 node:crypto 进 web bundle)
- [x] DB migration `0010_session_source.sql`：加 `source_json TEXT` 列 + 索引，回填老 PR 行（SQLite `json_object` 的 key 序与 `serializeSource()` 对齐）
- [x] `PRSession` 接口加 `source: SessionSource`
- [x] `SessionsRepo.insert` 接受 source；`rowToSession` 读回；`start-session.ts` 在 `parsePRTarget` 后构造 source 并落库
- [x] 现有测试全绿（一个 chokidar flaky 单测重跑通过）

**退出标准**：跑完所有测试，UI 行为零变化，DB 中老 PR session 仍可打开/rerun，新 session 的 `source_json` 正确写入。

### Phase 1 — Local branch source + provider 抽象 ✅ done (1d: 77cce1d)

> 引入 provider 接口（Metadata / Diff / SourceTree / Submission），同步实现 `GithubPrProvider` (包装现有逻辑) 和 `LocalBranchProvider`。这样抽象一上来就有两个实现验证。

**1a — SourceFlow 抽取（565b300）**

- [x] 新建 `src/server/source/`：`SourceFlow` 接口（不是四个分散的 provider）+ `getSourceFlow(source, deps)` dispatcher
- [x] `GithubPrFlow` 包装现有 `gh-client + source-prep + rerun-context`；`buildSourceMeta` 与旧 `prMeta` 字符串字节一致
- [x] `start-session.ts.prepareReview` 改走 `flow.fetchMetadata/fetchDiff/prepareSourceTree/loadPriorContext`

**1b — LocalBranchFlow + 路由 + submit gate（a811a21）**

- [x] `parseSessionInput()`：URL → PR；绝对路径/`~` → local-branch；可选 `localBranchHead` / `localBranchBase`
- [x] `LocalBranchFlow`：
  - metadata：`git log -1 --format=%an%x00%s%x00%b`，`url = null`
  - diff：`git diff <base>...<head>` 三点；base 默认走 `refs/remotes/origin/HEAD → origin/main → origin/master`
  - sourceTree：`git worktree add --detach <workdir>/repo <head-sha>`，复用 `cleanupWorktree(refName: null)`
  - submit：not-supported
- [x] Prior review context：local kind 返回 null
- [x] `StartSessionInput.source` 替换 `prInput`；rerun 直接复用 `session.source`；workdir 按 source kind 命名；PR-dedup 仅对 github-pr 触发
- [x] Submit route 对非 PR session 返回 409；engine 层 `SubmitNotSupportedError` 兜底

**1c — Prompt voice per session kind（282d9bf）**

- [x] `renderer.ts` 加 `{{#SESSION_KIND:<kind>}}…{{/SESSION_KIND}}` 机制（默认 github-pr，保持老 prompt 字节一致）
- [x] `framework.{en,zh-CN}.md`：opener 按 session kind 切换；中性化 "PR-wide" / "this PR" 文案
- [x] `start-session.ts` 把 `flow.source.kind` 喂给 `sessionKind` promptVar

**1d — UI（77cce1d）**

- [x] Home：方案 A 顶部 Tab（GitHub PR active / Local branch active / GitButler vbranch 灰显并标 "Phase 2"）
- [x] Home Local Tab：repoPath picker + 可选 head/base
- [x] PRDetail：local session 隐藏 Submit 按钮 + 标 "Read-only review"
- [x] Sidebar/RecentRow：local session 不再 render `owner/repo#number`，改 render `<basename> · <branch>`
- [x] i18n：补 en + zh-CN
- [x] e2e：补一个 local-branch 走通的 happy path（Phase 3 收尾时一起补完；测试在 tests/e2e/local-branch-happy-path.spec.ts，顺手暴露并修了 ExportPopover 在 local 源下因 prNumber=0 崩溃的 bug）

**退出标准**：在本仓库挑一个分支能跑出 findings，UI 全程可用，没有 Submit 入口；PR 路径仍然完整可用。

### Phase 2 — GitButler 虚拟分支 ✅ done (2a d862bdc, 2b 64d0673, 2c ae27e32, 2d 2a173e7; 2e 已经在 Phase 1c 282d9bf 顺手做了)

**Spike findings (but 0.19.13)**

- `but status --json` 是最完备的状态出口：`stacks[].branches[]` 列出 applied 栈里的所有 vbranch，按 **栈顶 → 栈底** 顺序排列。每个 branch 自带 `commits[]`（也是新→旧），每条 commit 含 `commitId` (full sha)。`mergeBase.commitId` 是工作区 target branch 的 merge-base。
- `but show <branchName> --json` 返回 `commits[]`（新→旧，整段栈，**不是只这个 branch 的 commits**）+ `baseCommit.sha`（始终等于 workspace mergeBase）。**不能**直接拿 `baseCommit.sha` 当 review base —— 对栈顶 branch 会把整条栈的 diff 算进去。
- `but branch list --json` 输出 `appliedStacks[].heads[].name`（只有名字 + 简要 review/CI 状态），不够算 diff base，**只能用来做"是否 GitButler 项目 + 可选 vbranch 列表"的快捷探测**。
- `but diff <branchName> --json` 返回结构化 diff（带 hunks），但不是 unified format。我们走 `git diff <base>..<tip>` 拿标准 unified，喂给现有 `engine/diff-*` 链路即可。
- vbranch tip = `status.stacks[].branches[branchIdx].commits[0].commitId`
- vbranch base = `branches[branchIdx + 1]?.commits[0]?.commitId ?? mergeBase.commitId`（栈底 branch 的 base 才是 workspace mergeBase；中间或顶部 branch 的 base 是它下方 branch 的 tip）

**实施清单**

- [x] spike：见上
- [x] `src/server/gitbutler/cli.ts`：execa wrapper + `findButExecutable()` 缓存；`parseButStatus` 校验失败抛 typed `ButCliError`
- [x] `src/server/gitbutler/inspect.ts`：`foldStatusToVBranches` 折叠 + `inspectLocalSource` 顶层接口
- [x] `/api/local-source/inspect?path=...`：返回 `{ kind: 'gitbutler' | 'git' | 'none', vbranches?, mergeBaseSha?, warning? }`
- [x] `src/server/source/gitbutler-vbranch-flow.ts`：完全复用 local-branch 的 readDiff + prepareLocalSourceContext；只额外做一次 `but status` 解析
- [x] `src/server/source/parse.ts`：`vbranchName` 选项路由到 vbranch 源
- [x] `src/server/source/registry.ts`：注册 `makeGitButlerVBranchFlow`
- [x] `src/server/start-session.ts` workdirSlug：之前 Phase 0/1 已经把 `vbranch-<basename>` 准备好了
- [x] prompts：`{{#SESSION_KIND:gitbutler-vbranch}}` 块（在 Phase 1c 282d9bf 一起做了）
- [x] Home vbranch tab：去掉 disabled，repo picker 触发 inspect；按 inspect 结果分支 (`none` / `git` / `gitbutler` / 空 workspace) 给不同提示
- [x] API 路由 vbranch 创建：POST /api/sessions 接收 `vbranchName`，parse 转 source
- [x] 单测：inspect 解析 + 折叠 + 栈对齐边界（空 branch、中间空 branch、栈底 base）；parse 路由；registry 路由；route 层 `kind=git/none`
- [ ] e2e：跳过（CI 无 but 二进制，靠手测 + 单测覆盖 provider）

### Phase 3 — UI 收尾 ✅ done

- [x] Sidebar：分两段 "PR" / "Local repos"，本地仓库按 repoPath 分组
- [x] 路由：`/session/:id` 主路径；`/pr/:id` 保留为 SPA 重定向（Navigate replace）
- [x] PRDetail 改名 `SessionDetail`；按 source kind 条件渲染 (external link / rounds 只在 PR 上显示，vbranch 与 local-branch 都按 local 处理)
- [x] i18n：补 `en.json`/`zh-CN.json` 的本地 review 文案（`sidebar.section.{pr,local,localUnknownRepo}`；`readOnlyReviewTitle` 中性化）
- [x] README + README.zh-CN：加 "Local branch + GitButler vbranch" 章节（截图 TODO，等 UI 稳定后补）

## 五、风险 / 未决

1. ~~**GitButler CLI 稳定性**：`but show <branch>` 是否真的能给出可 checkout 的 sha？~~ Resolved by Phase 2 spike — `but status --json` 是真源（参看 Phase 2 节）；`but show` 的 `baseCommit` 不能用作 review base，stacked branch 必须从 status 折叠出来。
2. **未 commit 的工作树脏改动 review**：本期不做。Phase 1 mockup B 曾出现"Working tree diff"段；落地时不实现。
3. **Diff line 锚定**：local diff 同样符合 "new file" 行号规则，`diff-line-validator` 不需要改。但若用户把 base 设成很老的 revision，hunk 大可能引发噪声 — Phase 1 提示一下即可。
4. **同仓库同分支重复发起**：用 `sourceHash(source)` 做活跃 session 去重；head sha 变了允许新开。

## 六、提交策略

- 同一分支 `feat/local-source-review` 上推进。
- 每个 Phase 内的多个 commit 用 conventional commits：`feat(source): …` / `refactor(server): …` / `feat(web): …`。
- Phase 收尾时打一个 `chore(plan): mark phase N done` 顺手 update 本文件。
