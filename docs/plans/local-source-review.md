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

| 维度 | 决定 |
|---|---|
| Home 输入 | **方案 A — 顶部 Tab**：`GitHub PR / Local branch / GitButler vbranch`；vbranch tab 仅当所选路径是 GitButler 项目时启用，否则灰显并 hint |
| Submit | **Local/vbranch session 完全禁用 Submit**；按钮 hidden，UI 标记 "Read-only review"；findings 仍可在 UI 内勾选/编辑/查看，但不外发 |
| Diff base | 默认 `merge-base(HEAD, refs/remotes/<default>/HEAD)`，兜底 `origin/main`；UI 可显式覆盖 |
| 路由 | `/pr/:id` 保留为别名；新 session 走 `/session/:id`（Phase 4 收尾时切换） |
| DB | 新增 `source_json` 列 + `source_hash` 唯一索引；旧 PR 行 migration 回填；老 PR 字段保留并改 nullable |

## 三、概念建模

```ts
type SessionSource =
  | { kind: 'github-pr';        owner: string; repo: string; number: number }
  | { kind: 'local-branch';     repoPath: string; head: string; base: string }
  | { kind: 'gitbutler-vbranch'; repoPath: string; vbranchName: string; base: string }
```

四个 Provider 接口（`src/server/source/`）：

- `MetadataProvider.fetch(source)` → `{ title, author, headSha, baseRef, headRef, url? }`
- `DiffProvider.fetch(source)` → `{ unifiedDiff, headSha }`
- `SourceTreeProvider.prepare(source, workdir)` → `SourceContext`（沿用现有 `SourceKind`）
- `SubmissionHandler.submit(session, payload)` → `SubmissionResult`（local kind 返回 not-supported）

## 四、阶段与进度

### Phase 0 — 抽象铺底（行为零变化）  ☐ in progress

- [ ] `src/shared/source.ts`：`SessionSource` 联合 + zod schema + `sourceHash()`
- [ ] 新建 `src/server/source/` 目录，定义四个 provider 接口
- [ ] 实现 `GithubPrProvider`，把现有 `gh-client + worktree + snapshot + submit` 包进去
- [ ] `start-session.ts`：`parseInput → SessionSource → providers.dispatch(...)`
- [ ] DB migration `0007_source_json.sql`：加列 + 回填 PR 行
- [ ] `PRSession` 接口加 `source: SessionSource`；PR 专属字段标 nullable
- [ ] 现有 server / cli / shared / web / e2e 测试全绿（无新功能）

**退出标准**：跑完所有测试，UI 行为零变化，DB 中老 PR session 仍可打开/rerun。

### Phase 1 — Local branch source  ☐

- [ ] `parseSessionInput()`：URL → PR；绝对路径/`~` → local-branch
- [ ] `LocalBranchProvider`：
  - metadata：`git log -1 --format=%H/%an/%s` + `url = null`
  - diff：`git diff <base>..<head>`；base 默认 `merge-base(HEAD, refs/remotes/<default>/HEAD)`，兜底 `origin/main`
  - sourceTree：复用 worktree.ts，去掉 fetch；`git worktree add --detach <workdir>/repo <head-sha>`
  - submit：返回 not-supported
- [ ] `framework.{en,zh-CN}.md`：加 `{{#SOURCE_KIND:local}}…{{/SOURCE_KIND}}` 分支；`{{PR_META}}` → `{{SOURCE_META}}`
- [ ] Prior review context：local kind 跳过（`priorCtx = null`）
- [ ] Rerun：复用 `session.source` 直接重投
- [ ] Home：方案 A 顶部 Tab（GitHub PR / Local branch），vbranch tab 灰显标 "Phase 2"
- [ ] PRDetail：local session 隐藏 Submit 按钮 + 标 "Read-only review"
- [ ] e2e：补一个 local-branch 走通的 happy path

**退出标准**：在本仓库挑一个分支能跑出 findings，UI 全程可用，没有 Submit 入口；PR 路径仍然完整可用。

### Phase 2 — GitButler 虚拟分支  ☐

- [ ] spike：确认 `but show <branch>` / `but status --json` 是否能稳定拿到 vbranch tip sha；写到 `docs/plans/local-source-review.md` 的"未决"区
- [ ] `/api/local-source/inspect?path=...`：返回是否为 GitButler 项目 + vbranch 列表（含 tip sha、commit count、diffstat）
- [ ] `GitButlerVBranchProvider`：diff 优先 `but show`，兜底 `git diff <merge-base>..<tip>`；sourceTree 同 local-branch；submit 禁用
- [ ] Home：vbranch tab 启用，按 inspect 接口拉列表
- [ ] prompts：加 vbranch 语义说明（"this is a single virtual branch checkout, other vbranches in the workspace are not included"）
- [ ] e2e：跳过（CI 没有 but 二进制，靠手测 + 单测覆盖 provider）

### Phase 3 — UI 收尾  ☐

- [ ] Sidebar：分两段 "PR" / "Local repos"，本地仓库按 repoPath 分组
- [ ] 路由：`/session/:id` 主路径；`/pr/:id` 保留 301
- [ ] PRDetail 改名 `SessionDetail`；按 source kind 条件渲染 (external link / rounds 只在 PR 上显示)
- [ ] i18n：补 `en.json`/`zh-CN.json` 的本地 review 文案
- [ ] README + README.zh-CN：加 "Local branch review" 章节，更新截图

## 五、风险 / 未决

1. **GitButler CLI 稳定性**：`but show <branch>` 是否真的能给出可 checkout 的 sha？Phase 2 前先 spike。
2. **未 commit 的工作树脏改动 review**：本期不做。Phase 1 mockup B 曾出现"Working tree diff"段；落地时不实现。
3. **Diff line 锚定**：local diff 同样符合 "new file" 行号规则，`diff-line-validator` 不需要改。但若用户把 base 设成很老的 revision，hunk 大可能引发噪声 — Phase 1 提示一下即可。
4. **同仓库同分支重复发起**：用 `sourceHash(source)` 做活跃 session 去重；head sha 变了允许新开。

## 六、提交策略

- 同一分支 `feat/local-source-review` 上推进。
- 每个 Phase 内的多个 commit 用 conventional commits：`feat(source): …` / `refactor(server): …` / `feat(web): …`。
- Phase 收尾时打一个 `chore(plan): mark phase N done` 顺手 update 本文件。
