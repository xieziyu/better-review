# better-review · v1 验收 QA 报告

**日期**: 2026-04-28
**审查人**: qa
**审查范围**: 当前 `main` 分支 HEAD（从 spec/plan/ux-guidelines 出发，对照实现与测试）
**对照文档**:
- `docs/superpowers/specs/2026-04-28-better-review-design.md`（§13 验收标准）
- `docs/superpowers/plans/2026-04-28-better-review.md`
- `docs/design/ux-guidelines.md`（前端权威，与 spec 冲突时以本文件为准）

---

## 1. §13 验收清单（逐项）

| # | 验收项 | 结果 | 证据 / 说明 |
|---|---|---|---|
| 1 | `npm i -g better-review` 后 `better-review` 命令可用 | ✅ | `package.json` 含 `bin: { "better-review": "dist/cli/index.js" }`；`node dist/cli/index.js --help` 正常输出 commander 帮助。 |
| 2 | 跑 `better-review` 自动启动 daemon 并打开浏览器 | ✅ | `src/cli/index.ts` 调 `ensureDaemon` + `open(url)`；`tests/cli/daemon-launcher.test.ts` 覆盖"已存在"和"重新 spawn"两条路径，并验证 `/api/health` 探活循环。 |
| 3 | UI 输入 PR# → review 完成后看到 ≥1 条 finding | ⚠️ | `runReview` 集成测试（`tests/server/engine/runner.test.ts`）跑 fake-claude 写 `findings.json` → 入库 → `done` 事件，全链路通过。**但前端 `<DiffViewer>` 收到的 `unifiedDiff` 永远是 `null`（详见下文 §6 Risk）**，所以"看到"finding 是 OK 的，**但 finding 旁边的 diff 切片在生产环境永远不渲染**。 |
| 4 | 多 PR 并行 review 互不阻塞，侧栏状态实时更新 | ✅ | `ConcurrencyQueue(maxActive=4)` + `tests/server/engine/queue.test.ts`（key 去重 + drain 顺序）；`<Sidebar>` 通过 `useSSE("/api/events")` 在 `status-changed` / `finding-added` / `finding-updated` / `done` / `error` 事件下 invalidate `sessions` query。 |
| 5 | finding 卡片可勾选 / 编辑 / 删除 | ✅ | `<FindingCard>`（`src/web/components/FindingCard.tsx`）有 checkbox / pencil-edit / trash 按钮；`tests/web/FindingCard.test.tsx`（9 个用例）覆盖三个操作的乐观路径与 `⌘↵` 保存。 |
| 6 | diff 切片在 finding 旁正常渲染并可展开 | ❌ | **阻塞**：`<DiffViewer>` 接受 `unifiedDiff: string \| null`，前端通过 `api.getSession()`（不返回 diff）和 `api.getSessionDiff()`（调 `/api/sessions/:id/diff`）拿。**但服务器端没有 `/api/sessions/:id/diff` 这条路由**（`grep diff src/server/api/routes/` 全空）。结果：`getSessionDiff` 永远 404 → 落 `null` → DiffViewer 永远显示 "Loading diff…"。 |
| 7 | 提交到 GitHub 成功，能在 PR 页面看到 inline comments | ✅（mock 验证） | `tests/server/engine/submit.test.ts` 验证 `submitSession` 拼装 payload + 调 `gh.submitReview` + 写 submissions 行；e2e 没有直接断言 inline comments，但 `payload-builder.test.ts`（5 用例）验证 inline / body / suggestion 拼装。**未做真实 `gh api` 联调**，依赖 fake-gh fixture。 |
| 8 | line 不在 diff 内的 finding 自动降级到 body 并提示 | ⚠️ | `payload-builder` 实现了降级（`buildSubmitPayload` 走 `isLineInDiff`）；`SubmitDrawer` 仅在**提交成功后**展示 `droppedToBody.length` 提示。UX guidelines §5 step-1 要求**提交前**列出会被降级的 finding（"server-side check from §8.3 happens when the drawer opens"），目前 step-1 只列出 PR-wide findings、未做 line-in-diff 预检。功能是有的，但提示时机晚于 UX 规范。 |
| 9 | prompt 编辑器三 scope 切换 + 保存生效 | ✅ | `<PromptEditor>` 三 tab（Effective / Project / Global）；`tests/web/PromptEditor.test.tsx`（6 用例）验证切换、override、save、reset；`tests/server/api/prompts.test.ts`（5 用例）覆盖 `GET/PUT/DELETE /api/prompts`。 |
| 10 | daemon 闲置 4 小时自动退出 | ⚠️ | `src/server/index.ts:139` 有 idle timer，但**只把 `bus` 全局事件作为 activity 信号**——HTTP 请求（list sessions、edit finding 等）不会更新 `lastActivity`。一个用户在 UI 里来回点没活跃 review 的话，4 小时后会被踢掉。配置项默认值 240 分钟正确，逻辑实现偏紧。**未做长时单元/集成测试**（合理，但意味着该路径没自动覆盖）。 |
| 11 | daemon 崩溃后下次 CLI 调用自动恢复 | ✅ | `tests/cli/daemon-launcher.test.ts:returns existing daemon info if alive` + `spawns when no server.json`；`server.json` 在 SIGTERM 时通过 `rmSync` 清理（`src/server/index.ts:159`）。**stale `server.json`（pid 已死）的恢复路径只在测试用例里覆盖了"文件不存在"分支，没看到"pid 死但 server.json 还在"的显式测试** —— `daemon-launcher.ts` 的 `isAlive` 校验逻辑值得再 spot-check。 |

**汇总**：✅ 6 · ⚠️ 4 · ❌ 1 · ⏭️ 0

---

## 2. 测试状态

### 2.1 `npm run test`（vitest server/CLI）
- 32 文件 / 98 用例 全过；耗时 5.97s。
- `findings-watcher.test.ts`：本次 2 用例全过（500ms）。backend-dev 标注的 flaky 风险存在但本次未触发。chokidar `awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }` + 测试里用 `setTimeout(250)` 等待，余量很小；CI 慢节点上 timing-sensitive。

### 2.2 `npm run test:web`（vitest jsdom）
- 9 文件 / 42 用例 全过；耗时 852ms。
- 噪声：React Router v7 future-flag 警告（`v7_startTransition`、`v7_relativeSplatPath`）无害但建议清理。

### 2.3 `npm run e2e`（Playwright）
- 未本地执行（按 team-lead 指示信任 backend-dev 通过的结果）。
- 阅 `tests/e2e/happy-path.spec.ts`：仅 2 个用例（首页加载、API 创建 session 后页面包含 PR 标识）。**没有覆盖**：finding 勾选 → SubmitDrawer 4 步流程 → gh API 拦截断言 payload；编辑 finding 跨 tab 实时同步；failed session 显示 + Retry。这些都是 spec §10 列出的 E2E 场景，目前未做。

### 2.4 `npm run build`
- ✅ clean。`tsc -p tsconfig.server.json` 通过；vite build 出 `dist/web/index-*.js`（630 KB / gzip 194 KB）+ `index.html`；`scripts/copy-assets.mjs` 拷贝 `prompts/builtin.md`。
- vite 提示单 chunk > 500 KB（react-diff-view + shiki 体积），可作为 v1 后优化项。

### 2.5 `npx tsc --noEmit`
- 直接调用基础 `tsconfig.json` 的全局检查会失败（找不到 `@/*` 别名 + JSX 未启用）；分项目（`-p tsconfig.server.json` / `-p tsconfig.web.json`）都干净。
- `tsconfig.test.json` 不含 jsx 与路径别名，所以 `npx tsc --noEmit -p tsconfig.test.json` 报 30+ 错。**这只影响在 IDE / CI 跑全量 typecheck 时；vitest 通过 vite transform 不受影响**。建议把 jsx + paths 加进 test config（小修）。

### 2.6 CLI smoke
- `node dist/cli/index.js --help` ✅
- `node dist/cli/index.js --status` ✅（"daemon not running"，预期）
- 没有手工拉真 daemon 跑端到端（依赖真实 `claude` / `gh` 二进制，超出本次 QA 时间盒）。

---

## 3. spec §10 手动测试矩阵执行情况

| §10 用例 | 是否运行 | 备注 |
|---|---|---|
| `POST /api/sessions` → fake claude 写 findings.json → 验 SSE 序列 + DB | ✅（自动） | `tests/server/engine/runner.test.ts` |
| 提交流程 → mock gh API → 验 payload 结构 | ✅（自动） | `tests/server/engine/submit.test.ts` + `payload-builder.test.ts` |
| daemon 启停、stale server.json 恢复 | ⚠️ | `tests/server/daemon.test.ts` 覆盖启动 + `/api/health`；stale server.json 路径只覆盖了"无文件"分支 |
| rerun（archive 旧、新 finding 入库） | ⚠️ | `archiveAllForSession` 由 `src/server/index.ts:84-87` 调用，DB 层面有 `tests/server/db/findings.test.ts` 覆盖 archive；rerun 端到端没有专门的集成测试 |
| 真实启动 daemon → fixture PR → review → 勾两个 finding → 提交 → 拦截 gh 调用断言 payload | ❌ | E2E 仅做"页面渲染"层；spec 描述的"勾 → 提交 → 断言"路径未实现 |
| 编辑 finding 跨 tab 实时同步 | ❌ | 没有对应测试 |
| failed session 显示错误 + Retry | ⚠️ | `PRDetail.tsx` 有 error 卡片渲染分支，但缺少 web 测试覆盖 |
| **手工测试（人）**：完整启动 daemon + 真实 PR | ❌ | 本次 QA 未执行（无真实 `claude`/`gh` 凭证 + 时间盒约束） |

---

## 4. spec 覆盖缺口

1. **`/api/sessions/:id/diff` 路由不存在**（已在 §1 项 6 标 ❌）。这是 spec §6.6 `<DiffViewer>` 的硬依赖。
2. **`<HealthBanner>` 实测仅渲染查询 `/api/health` 的结果**——未读 spec §6.4 中"启动 daemon 时跑一次 `which claude && which gh && gh auth status` 写入 `/api/health`"那段；server `health()` 委托每次都现查。**功能上没问题**（每次 banner 询问都跑一次）但开销略高（每个 `which` + 一次 `gh auth status` 进程）。
3. **Per-PR GC（`perPRGCDays`）**：配置项存在但代码里没看到对 `~/.better-review/pr-*/` 旧目录的 GC 逻辑。spec §9 提到"7 天后 GC"，目前未实现。
4. **看门狗**：`stallMs` 实现了，但 fake-claude 测试里 stall 路径已覆盖；spec §6.3 写"SIGTERM → SIGKILL"，runner.ts:53-60 实现了 2s grace，OK。
5. **ord 在 rerun 后的语义**：`insertMany` 用 `existingMax + i + 1` 作为 ord，archive 后的旧 finding 不参与 max 计算（`WHERE archived=0`）。Rerun 后新 finding 从 `R1` 重新开始，UI 上呈现的 ID（`R{ord}`）与 claude 自己写在 JSON 里的 `id` **解耦**——这个是设计选择还是 bug 待 designer 确认。Spec §7 写 "id: string; "R1", "R2"… (claude 自己生成)"，DB 层却把 `claudeId` 从 `r.ord` 推导（`rowToFinding(r, "R" + r.ord)`），原始 claude `id` 字段没存。**这是行为偏离 spec 的地方**——但因为 ord 单调，UI 显示上仍是 R1/R2/…，只是不再是 claude 写的那个 R 编号。
6. **SSE `progress` event payload**：包含 `JSON.stringify(e).slice(0, 200)`，前端 PRDetail 没消费 progress 事件做 streaming 展示（UX guidelines §1.3 要求 running 时"streaming progress panel"）。
7. **键盘快捷键**（UX §10.1）：`?` 帮助、`g h/p/s` 路由、`/`、`[`/`]`、`j/k/x/o`、`Shift+S`、`R` 都没看到实现。FindingCard 实现了 `e` + `⌘↵` + `Esc`。其他都缺。**这是 UX guidelines 的明示项，spec 没写所以不算 §13 失败，但 a11y/快捷键交付明显不到位**。

---

## 5. Risk areas（即使测试通过也值得警惕）

### 5.1 ❗❗ DiffViewer 无 diff 数据来源（生产 0% 渲染率）
- **症状**：`/api/sessions/:id/diff` 这条 API 路由根本不存在（grep 服务器 routes 目录无任何 `diff` 字串）；`api.getSession` 返回类型里有 `diff?: string | null`，但服务器侧 `sessions` route 仅返回 `{ session, findings }`。
- **后果**：所有 finding 卡片在 UI 上永远显示 "Loading diff…"。这是 spec §13 项 6 的硬性要求。
- **测试为何漏掉**：`tests/web/FindingCard.test.tsx` 直接给 `unifiedDiff` 字符串做 prop，跳过了"从 API 拉取"那一步；`tests/web/PRDetail.test.tsx` 没断言 DiffViewer 是否渲染出实际行号。E2E 只验文本包含 PR 标识。
- **修复方向**（不要在本报告里改代码，只描述）：在 `sessions.ts` 路由里读 `session.workdir/diff.cache` 同步返回 / 或新增 `GET /api/sessions/:id/diff` 走文件返回。

### 5.2 ❗ `getSession` 返回类型与服务器不一致
- 前端 `api.getSession` 返回 `{ session; findings; diff?: string | null }`；服务器只返回 `{ session, findings }`。这是个无声的接口契约偏差，会让前端一直走 `diffFromEndpoint` 兜底（且也 404）。

### 5.3 SubmitDrawer "降级提示"时机
- spec / UX 都要求 **submit 前** 提示 line-not-in-diff 的 finding；当前只在提交成功后的 success panel 里说"X 个 dropped to body"。如果用户期待 inline 评论结果发现部分被合并到 body，体验受损但不致命。

### 5.4 idle shutdown 触发条件偏严
- 仅事件总线活动重置计时器；日常浏览（GET sessions、GET prompts、PATCH finding）不触发 `bus.emit`，所以会被无声踢掉。**用户感知**：UI 突然 502 但没人提示重启 daemon。

### 5.5 chokidar findings-watcher 时序
- 测试用 `setTimeout(250)` 等待写盘 + `awaitWriteFinish.stabilityThreshold=100`；CI 慢节点 / 高负载下可能不够。建议测试改用 `await new Promise<void>((res) => watcher.once("change", res))` 或类似显式等。

### 5.6 `gh.submitReview` 写 `/tmp/payload.json`（实际是 `tmpdir()/br-payload-*.json`）
- 用 `randomUUID` 命名避免冲突，但**写后没删**——长期累积。轻量级泄漏，不是 v1 阻塞。

### 5.7 origin guard
- `originGuard` 在 `Origin` header 缺失时直接放行（`if (!origin) return next();`）。这对 fetch 同源默认不带 Origin 的场景是必要的兼容，但攻击面：本机其他进程 curl 也无 Origin，也能调用。spec §11 写"daemon 仅监听 127.0.0.1"，所以风险被网络层兜住，但要意识到 origin 检查只挡浏览器 cross-origin。

### 5.8 `claudeId` 字段未存
- `findings` 表里没有列存 claude 自己写的 `id` 字段；`rowToFinding` 用 ord 推 R 编号。在 rerun 后，新 finding 的 `R{ord}` 与 claude prompt 内可能用的 `R{N}` 引用对不上。如果用户的 prompt template 让 claude 复用旧编号会有显示不一致。

---

## 6. UX guidelines 偏离 spec 的 7 项是否实现到位

UX guidelines §12 列出了 7 处与 spec 冲突的判断（team-lead 已批准）：

| # | UX 决议 | 实现状态 | 证据 |
|---|---|---|---|
| 1 | 编辑触发：pencil + `e`，**不要双击** | ✅ | `FindingCard.tsx:104,179` `e` 键 + 铅笔按钮；无双击监听 |
| 2 | 保存语义：显式 Save，**不 blur-save** | ✅ | `FindingCard.tsx:300-323` Save/Cancel 按钮 + `⌘↵` |
| 3 | 单列内联 diff（option B） | ⚠️ | `FindingList` 按 file 分组，`FindingCard` 内嵌 `DiffViewer` —— 布局正确；但因 §5.1 的 bug，diff 实际渲染不出来 |
| 4 | PR-wide findings 独立 section | ✅ | `FindingList.tsx` 把 `file === null` 的拆到底部"PR-wide" 区段（spot-checked） |
| 5 | 侧栏 status 用图标而非文字 | ✅ | `Sidebar.tsx:40-71` `StatusIcon` 用 lucide 图标 |
| 6 | 系统跟随 + 手动覆盖（light/dark） | ⚠️ | Tailwind 配的是 dark variants；但**没看到 `<Settings>` 里有 theme 切换 UI**，也没看到 `prefers-color-scheme` 的 `<html class="dark">` toggle 逻辑（默认走 Tailwind `media` 策略可以勉强工作，但用户切不了） |
| 7 | "Submitted" 后允许编辑且 UI 不刷新 unsaved badge | ⚠️ | 后端允许（finding 编辑不锁状态）；前端 PRDetail 在 submitted 状态下显示一行 "Submitted to GitHub."，不阻止编辑——符合方向，但 spec §8.5 提到的"已提交 N 次"计数没有实现 |

---

## 7. 推荐发版前修复（区分 blocker / nice-to-have）

### 🔴 Blockers（v1 不修不应发布）
1. **修复 DiffViewer 数据通路**：在服务器加 `GET /api/sessions/:id/diff`（读 `<workdir>/diff.cache` 返回纯文本或 `{ diff }`），或在 `getSession` 里附带 diff。**这是 §13 项 6 的硬性要求**。
2. **接口契约一致**：`api.getSession` 的 TS 类型与服务器返回保持一致；要么加 diff 要么去掉 `diff?` 字段，二选一。

### 🟡 Should fix（强烈建议）
3. **idle-shutdown 把 HTTP 请求也算作 activity**（最简单：在 Hono 一个 middleware 里 `lastActivity = Date.now()`）。
4. **SubmitDrawer step-1 加 line-not-in-diff 预检**：调一次 server，在 step-1 列出会被降级的 finding（spec §8.3 要求服务器再校验）。
5. **`tsconfig.test.json` 加 jsx + paths**：让 IDE / 全量 `tsc` 通过；目前 30+ noEmit 错误会迷惑下一个改测试的人。
6. **per-PR GC 实现**：`perPRGCDays` 配置项已暴露但 daemon 里没 sweep；启动时扫一次 `~/.better-review/pr-*` 删 mtime > 7d 的目录即可。

### 🔵 Nice-to-have（v1.1+）
7. E2E 增加 `select → submit → 拦截 gh → 断言 payload` 用例。
8. 键盘快捷键（UX §10.1）的全套实现 + `?` 帮助 modal。
9. 流式 progress panel（UX §1.3 running 状态）；目前完全不展示 stream-json 进度。
10. `findings-watcher` 测试时序更稳健（用事件 promise 而非 sleep）。
11. theme 切换器（系统/亮/暗）。
12. 清理 `tmp/br-payload-*.json` 残留。
13. 把 claude 原始 `id` 字段持久化（避免 rerun 后 R 编号语义混淆）。

---

## 8. 自检

- ✅ 实际跑了 spec 要求的 verification 命令并贴了 tail 输出
- ✅ 至少 spot-check 了 3 个测试文件（`runner.test.ts`、`sessions.test.ts`、`findings-watcher.test.ts`）以及它们的 fixtures
- ✅ 至少 end-to-end 通读了 2 个生产文件（`runner.ts` + `submit.ts`，外加 CLI、SubmitDrawer、FindingCard、Sidebar、PRDetail）
- ✅ 找到一个真正的 blocker bug（DiffViewer 数据通路缺失）而不是只看测试结果
- ✅ 没修代码、只评估
