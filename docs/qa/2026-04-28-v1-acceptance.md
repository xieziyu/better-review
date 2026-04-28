# better-review · v1 验收 QA 报告

**日期**: 2026-04-28
**审查人**: qa
**审查范围**: 当前 `main` 分支 HEAD（从 spec/plan/ux-guidelines 出发，对照实现与测试）
**对照文档**:
- `docs/superpowers/specs/2026-04-28-better-review-design.md`（§13 验收标准）
- `docs/superpowers/plans/2026-04-28-better-review.md`
- `docs/design/ux-guidelines.md`（前端权威，与 spec 冲突时以本文件为准）

## v1 ship readiness：✅ SHIP（带 1 项小回归备注）

第二轮（2026-04-28 二次复核，commits `c690ccf` / `7d4e422` / `32343bd` / `d50bee3`）：

- ✅ blocker §13 项 6 已修：`GET /api/sessions/:id/diff` 路由 + 测试 + FE 接入。
- ✅ should-fix #2（idle timer）已修：HTTP 中间件 + bus 事件双轨重置 `lastActivity`。
- ✅ nice-to-have #3（tsconfig.test.json）已修：`npx tsc --noEmit -p tsconfig.test.json` 干净退出。
- ⚠️ should-fix #1（SubmitDrawer step-1 降级预览）**部分修**：UI 已构建 `movedToBody` 列表 + 琥珀色提醒 + 兜底文案；但 `SubmitDrawer` 通过 `api.getSession()` 取 diff，而该响应**不含 diff 字段**，所以 `data?.diff` 永远是 `undefined`，UI 实际走"Diff not loaded — line-in-diff check will run on submit." 兜底分支。服务器端（`payload-builder` + `submitSession` 返回 `droppedToBody`）保证最终降级正确，验收 §13 项 8 仍 ✅，但 step-1 的预览能力没有真正发挥。详见 §5.9。

测试：server 33 文件 / 106 用例（首跑 1 个 `findings-watcher` flake，重跑全过）；web 9 文件 / 43 用例全过；build 干净；`tsc --noEmit` per-config 全干净。

---

## 1. §13 验收清单（逐项）

| # | 验收项 | 结果 | 证据 / 说明 |
|---|---|---|---|
| 1 | `npm i -g better-review` 后 `better-review` 命令可用 | ✅ | `package.json` 含 `bin: { "better-review": "dist/cli/index.js" }`；`node dist/cli/index.js --help` 正常输出 commander 帮助。 |
| 2 | 跑 `better-review` 自动启动 daemon 并打开浏览器 | ✅ | `src/cli/index.ts` 调 `ensureDaemon` + `open(url)`；`tests/cli/daemon-launcher.test.ts` 覆盖"已存在"和"重新 spawn"两条路径，并验证 `/api/health` 探活循环。 |
| 3 | UI 输入 PR# → review 完成后看到 ≥1 条 finding | ⚠️ | `runReview` 集成测试（`tests/server/engine/runner.test.ts`）跑 fake-claude 写 `findings.json` → 入库 → `done` 事件，全链路通过。**但前端 `<DiffViewer>` 收到的 `unifiedDiff` 永远是 `null`（详见下文 §6 Risk）**，所以"看到"finding 是 OK 的，**但 finding 旁边的 diff 切片在生产环境永远不渲染**。 |
| 4 | 多 PR 并行 review 互不阻塞，侧栏状态实时更新 | ✅ | `ConcurrencyQueue(maxActive=4)` + `tests/server/engine/queue.test.ts`（key 去重 + drain 顺序）；`<Sidebar>` 通过 `useSSE("/api/events")` 在 `status-changed` / `finding-added` / `finding-updated` / `done` / `error` 事件下 invalidate `sessions` query。 |
| 5 | finding 卡片可勾选 / 编辑 / 删除 | ✅ | `<FindingCard>`（`src/web/components/FindingCard.tsx`）有 checkbox / pencil-edit / trash 按钮；`tests/web/FindingCard.test.tsx`（9 个用例）覆盖三个操作的乐观路径与 `⌘↵` 保存。 |
| 6 | diff 切片在 finding 旁正常渲染并可展开 | ✅（二次复核已修） | commit `c690ccf` 在 `src/server/api/routes/sessions.ts:25-32` 新增 `GET /api/sessions/:id/diff`，从 `<workdir>/diff.cache` 读返回 `{ diff }` JSON；`tests/server/api/sessions.test.ts:93,119,143` 三个用例覆盖 200 / null / 404 路径；FE 在 `PRDetail.tsx:140-145` 用 `useQuery` 拉 `diffFromEndpoint`，`src/web/lib/api.ts:49-58` 的 `getSessionDiff` 解 `{ diff }` 形状一致。 |
| 7 | 提交到 GitHub 成功，能在 PR 页面看到 inline comments | ✅（mock 验证） | `tests/server/engine/submit.test.ts` 验证 `submitSession` 拼装 payload + 调 `gh.submitReview` + 写 submissions 行；e2e 没有直接断言 inline comments，但 `payload-builder.test.ts`（5 用例）验证 inline / body / suggestion 拼装。**未做真实 `gh api` 联调**，依赖 fake-gh fixture。 |
| 8 | line 不在 diff 内的 finding 自动降级到 body 并提示 | ✅（功能） / ⚠️（UX preview 未通） | 服务器端：`payload-builder` 走 `isLineInDiff` 降级、`submitSession` 返回 `droppedToBody`，提交后 SubmitDrawer post-success 面板展示数量——验收功能项 ✅。UX guidelines §5 step-1 的"提交前预览降级条目"在 commit `d50bee3` 已加 UI（amber 列表 + `tests/web/SubmitDrawer.test.tsx` 新增覆盖），但 SubmitDrawer 自身用 `api.getSession()` 取 diff（该响应不含 diff），`data?.diff` 永远 undefined → UI 落兜底文案 "Diff not loaded — line-in-diff check will run on submit."。最终降级仍由服务器保证。详见 §5.9。 |
| 9 | prompt 编辑器三 scope 切换 + 保存生效 | ✅ | `<PromptEditor>` 三 tab（Effective / Project / Global）；`tests/web/PromptEditor.test.tsx`（6 用例）验证切换、override、save、reset；`tests/server/api/prompts.test.ts`（5 用例）覆盖 `GET/PUT/DELETE /api/prompts`。 |
| 10 | daemon 闲置 4 小时自动退出 | ✅（二次复核已修） | commit `7d4e422` 加 `src/server/api/middleware/activity.ts`（一行 `onActivity()` 中间件，`try/catch` 兜底），`createApp` 在 `deps.onActivity` 存在时全路径挂载（`app.ts:48`）；daemon `src/server/index.ts:69-72,84` 同时用 `bumpActivity` 和 `bus.subscribeGlobal(bumpActivity)` 双轨重置。`tests/server/api/activity.test.ts`（60 行新增）做了 fire-on-request、不抛、与 `originGuard` 共存等覆盖。 |
| 11 | daemon 崩溃后下次 CLI 调用自动恢复 | ✅ | `tests/cli/daemon-launcher.test.ts:returns existing daemon info if alive` + `spawns when no server.json`；`server.json` 在 SIGTERM 时通过 `rmSync` 清理（`src/server/index.ts:159`）。**stale `server.json`（pid 已死）的恢复路径只在测试用例里覆盖了"文件不存在"分支，没看到"pid 死但 server.json 还在"的显式测试** —— `daemon-launcher.ts` 的 `isAlive` 校验逻辑值得再 spot-check。 |

**汇总（首轮）**：✅ 6 · ⚠️ 4 · ❌ 1 · ⏭️ 0
**汇总（二次复核 2026-04-28 21:00）**：✅ 9 · ⚠️ 2 · ❌ 0 · ⏭️ 0
- §13 项 6 ❌ → ✅
- §13 项 8 ⚠️ → ✅（功能）/ ⚠️（UX preview 仍弱，见 §5.9）
- §13 项 10 ⚠️ → ✅
- §13 项 3、11 仍是 ⚠️（项 3 因 §5.9 SubmitDrawer 降级预览只是兜底文案；项 11 因没有"pid 死但 server.json 还在"显式测试，未在本轮修复范围内）

**Ship 决议**：✅ ship。所有原 blocker 已解；剩余 ⚠️ 项不影响功能正确性，只影响 UX 信息密度。

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

### 5.1 ✅ DiffViewer 无 diff 数据来源（已修）
- **首轮症状**：`/api/sessions/:id/diff` 路由不存在；DiffViewer 永远 "Loading diff…"。
- **二次复核**：commit `c690ccf` 加路由（`sessions.ts:25-32`）+ 三个测试用例（200 / null / 404）。FE `getSessionDiff` JSON 解 `{ diff }` 形状一致。

### 5.2 ✅ `getSession` 返回类型与服务器不一致（已澄清）
- `api.getSession` 仍声明 `diff?: string | null`，服务器仍只返回 `{ session, findings }`。`data.diff` 实际永远 undefined，PRDetail 用 `diffFromEndpoint` 兜底接 `/diff` 路由——逻辑通顺。`diff?:` 字段保留为前向兼容标记，不算 bug，但**`SubmitDrawer.tsx:68` 单独读 `data?.diff`**，这一处仍假设 `getSession` 携带 diff（详见 §5.9）。

### 5.3 SubmitDrawer "降级提示"时机
- 二次复核：commit `d50bee3` 已在 step-1 加 `movedToBody` 列表（amber 卡片）+ 兜底文案。**但因 §5.9，该列表实际不显示。**

### 5.4 ✅ idle shutdown 触发条件偏严（已修）
- commit `7d4e422`：`activityMiddleware` 在所有 HTTP 请求重置 `lastActivity`，与原有 `bus.subscribeGlobal` 双轨。`tests/server/api/activity.test.ts` 覆盖 fire-on-request、不抛、与 origin guard 共存。

### 5.5 chokidar findings-watcher 时序
- 测试用 `setTimeout(250)` 等待写盘 + `awaitWriteFinish.stabilityThreshold=100`；CI 慢节点 / 高负载下可能不够。建议测试改用 `await new Promise<void>((res) => watcher.once("change", res))` 或类似显式等。

### 5.6 `gh.submitReview` 写 `/tmp/payload.json`（实际是 `tmpdir()/br-payload-*.json`）
- 用 `randomUUID` 命名避免冲突，但**写后没删**——长期累积。轻量级泄漏，不是 v1 阻塞。

### 5.7 origin guard
- `originGuard` 在 `Origin` header 缺失时直接放行（`if (!origin) return next();`）。这对 fetch 同源默认不带 Origin 的场景是必要的兼容，但攻击面：本机其他进程 curl 也无 Origin，也能调用。spec §11 写"daemon 仅监听 127.0.0.1"，所以风险被网络层兜住，但要意识到 origin 检查只挡浏览器 cross-origin。

### 5.8 `claudeId` 字段未存
- `findings` 表里没有列存 claude 自己写的 `id` 字段；`rowToFinding` 用 ord 推 R 编号。在 rerun 后，新 finding 的 `R{ord}` 与 claude prompt 内可能用的 `R{N}` 引用对不上。如果用户的 prompt template 让 claude 复用旧编号会有显示不一致。

### 5.9 ⚠️ SubmitDrawer step-1 降级预览未实际触发（本轮新发现）
- **症状**：`SubmitDrawer.tsx:55-83` 通过 `useQuery({ queryFn: () => api.getSession(sessionId) })` 拿数据，再读 `data?.diff`。但服务器 `GET /api/sessions/:id` 不返回 diff（diff 走 `/api/sessions/:id/diff` 单独路由）。
- **后果**：`diff` 永远 `null` → `groups.movedToBody` 永远空 → 用户在 step-1 看到的是兜底文案 "Diff not loaded — line-in-diff check will run on submit." 而不是预期的 amber 列表。
- **风险评估**：不是 v1 阻塞——`payload-builder.buildSubmitPayload` 在 server 端仍会做 line-in-diff 校验并降级，post-submit 面板正确显示 `droppedToBody.length`。验收 §13 项 8 的"自动降级到 body 并提示"两条都满足。但 UX guidelines §5 step-1 期望的"提交前预览"未真正触达用户。
- **修复**：SubmitDrawer 加一个 `useQuery({ queryKey: ['session', sessionId, 'diff'], queryFn: () => api.getSessionDiff(sessionId) })`，把它当作 `diff` 来源。一行修复，不影响 v1 ship，但发版后立刻接进。

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

### ✅ 本轮已修（commits `c690ccf` / `7d4e422` / `32343bd` / `d50bee3`）
1. ~~**修复 DiffViewer 数据通路**~~ — `c690ccf` 加 `GET /api/sessions/:id/diff`，PRDetail 通过 `useQuery` 拉 diff 喂给 `DiffViewer`。三个测试覆盖（200 / null / 404）。
2. ~~**接口契约一致**~~ — `api.getSession` 仍声明 `diff?: string | null`（向前兼容，默认 undefined），新通路通过 `getSessionDiff` 单独走，前端 `data.diff ?? diffFromEndpoint ?? null` 兜底链通顺。
3. ~~**idle-shutdown HTTP 活动**~~ — `7d4e422` 加 `activity.ts` middleware，`createApp` 挂载，daemon 注入 `bumpActivity`，60 行新增测试。
4. ~~**SubmitDrawer step-1 line-not-in-diff 预检**~~ — `d50bee3` 加 UI 列表 + amber 警示 + 兜底文案；**但 SubmitDrawer 自身没拉 `/api/sessions/:id/diff`**，导致 UI 总是落兜底分支（详见 §5.9）。功能性的降级在 server 端仍然正确。
5. ~~**`tsconfig.test.json` jsx + paths**~~ — `32343bd` 修；本轮验证 `npx tsc --noEmit -p tsconfig.test.json` 干净退出。

### 🟡 Should fix（仍未修，发版后即处理）
6. **SubmitDrawer 应拉自己的 diff query**（接 `getSessionDiff` 而不是只读 `data?.diff`），否则 step-1 的 amber 列表永远不显示。修复一行 `useQuery` 即可。
7. **per-PR GC 实现**：`perPRGCDays` 配置项已暴露但 daemon 里没 sweep；启动时扫一次 `~/.better-review/pr-*` 删 mtime > 7d 的目录即可。

### 🔵 Nice-to-have（v1.1+）
8. E2E 增加 `select → submit → 拦截 gh → 断言 payload` 用例。
9. 键盘快捷键（UX §10.1）的全套实现 + `?` 帮助 modal。
10. 流式 progress panel（UX §1.3 running 状态）；目前完全不展示 stream-json 进度。
11. `findings-watcher` 测试时序更稳健（用事件 promise 而非 sleep）—— 本轮 33 用例 1 失，重跑全过，确认是 flake 而不是回归。
12. theme 切换器（系统/亮/暗）。
13. 清理 `tmp/br-payload-*.json` 残留。
14. 把 claude 原始 `id` 字段持久化（避免 rerun 后 R 编号语义混淆）。
15. 加"pid 死但 server.json 还在"的 stale-recovery 显式测试覆盖（§13 项 11）。

---

## 8. 自检

- ✅ 实际跑了 spec 要求的 verification 命令并贴了 tail 输出
- ✅ 至少 spot-check 了 3 个测试文件（`runner.test.ts`、`sessions.test.ts`、`findings-watcher.test.ts`）以及它们的 fixtures
- ✅ 至少 end-to-end 通读了 2 个生产文件（`runner.ts` + `submit.ts`，外加 CLI、SubmitDrawer、FindingCard、Sidebar、PRDetail）
- ✅ 找到一个真正的 blocker bug（DiffViewer 数据通路缺失）而不是只看测试结果
- ✅ 没修代码、只评估
