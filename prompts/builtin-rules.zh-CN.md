### 1. 范围与计划对齐

- 标记 PR 描述之外的改动（在 bug 修复里夹带无关重构等）。
- 标记**缺失**的部分 —— PR body 承诺但 diff 没有实际实现的功能。
- 把偏离分类为**有理由的改进** / **可接受的差异** / **有问题的偏离**。只有最后一种需要修复。

### 2. 正确性与类型安全

- **绕过类型检查的逃生口**：`as any`、`@ts-ignore`、`@ts-expect-error`、绕过真实检查的非空断言（`!`）、对运行时形状说谎的 cast。除非 PR 显式给出每一处的理由，否则视为 🔴 **must fix**。
- **null / undefined 访问**：对可能不存在的值缺少保护；可选链之后紧跟属性/方法访问而没有兜底。
- **资源泄漏**：未关闭的 stream、DB 连接、文件句柄、从未移除的事件监听、从未清理的 timer。
- **竞态条件**：对共享状态的并发修改没有同步；请求路径中存在未 await 的 promise。
- **逻辑错误**：off-by-one、反向比较、参数顺序颠倒、控制流漏掉了需求中的某一种情况。

### 3. 安全

- **注入**：通过未净化的用户输入造成的 SQL、NoSQL、XSS、command、路径穿越。
- **认证 / 授权**：新增 endpoint 缺少 authentication、authorization 或租户隔离检查。
- **敏感数据外泄**：secret、token、PII 被写入日志、写入 response 或落入代码仓库。
- **依赖变更**：新增或升级的包 —— 检查已知漏洞、typosquat、可疑维护者。

### 4. 架构与设计

- **分层**：route / application / domain / infra 的边界保持清晰；不在 route 中写 domain 逻辑，不让 DB 细节泄漏到 domain。
- **依赖注入**：新增的 class 通过构造器/DI 接入依赖；避免在业务代码里 `new X(...)` 或隐藏的全局。
- **重复逻辑**：如果某段工具函数看起来通用，先检查仓库里是否已有同类实现，再决定要不要做局部重新实现。
- **契约一致性**：input 类型要与 entity 实际存储的字段匹配；标记 dead field（input 携带了 entity 永远不读的属性）。

### 5. 性能

- **N+1 查询**；循环内重复的 DB / RPC 调用，本可批量执行。
- **不必要的分配** 出现在热路径中（大对象 spread、反复 JSON 序列化/反序列化、每次调用重新编译 regex）。
- **算法低效**，当真实数据规模会暴露问题时。
- **无界读取**：数据集可能增长的场景下没有 limit 的查询/迭代。

### 6. 命名与可读性

- 变量、函数、class 名应当自描述且与相邻文件一致。
- 单复数错配（例如 `const episode = arr.map(...)` 用在数组上）。
- class 名与文件名的词序漂移。
- 死代码、误导性注释、过度简短的标识符。

### 7. 复杂度

- 深度嵌套的条件、过长的函数、上帝类（god-class）。
- 在合适的地方建议抽出 helper 或使用 early return。
- 硬编码的魔法值（ID、URL、阈值）—— 建议挪到 config / 常量 / 共享 enum。

### 8. 错误处理

- 被悄悄吞掉的错误（空 `catch`、`.catch(() => {})` 既不 rethrow 也不 log）。
- 抛出的错误应带有有意义的 message 和定位上下文（哪个 entity、哪个 input）。
- 在 API 边界使用领域专属的错误类型；不要把堆栈或内部路径泄漏给客户端。

### Category labels

`category` 字段必须使用以下英文字符串之一：
`Scope` · `Correctness` · `Type Safety` · `Security` · `Architecture` · `Performance` · `Naming` · `Complexity` · `Error Handling`
