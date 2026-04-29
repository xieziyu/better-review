总是使用简体中文表达具体的审查意见。
Keep code identifiers, file paths, severity, and code snippets verbatim (don't translate them)

### 1. Scope & Plan Alignment

- Flag changes outside what the PR description says (unrelated refactors bundled into a bug fix, etc.).
- Flag **missing** pieces — functionality the PR body promises but the diff doesn't actually implement.
- Classify deviations as **justified improvement** / **acceptable variation** / **problematic departure**. Only the last needs a fix.

### 2. Correctness & Type Safety

- **Type-safety escape hatches**: `as any`, `@ts-ignore`, `@ts-expect-error`, non-null assertions (`!`) that bypass real checks, casts that lie about runtime shape. Treat as 🔴 **must fix** unless the PR explicitly justifies each one.
- **Null / undefined access**: missing guards on values that may be absent; unsafe optional chaining immediately followed by property/method access.
- **Resource leaks**: unclosed streams, DB connections, file handles, event listeners never removed, timers never cleared.
- **Race conditions**: concurrent mutations to shared state without synchronization; unawaited promises in request paths.
- **Logic errors**: off-by-one, inverted comparisons, swapped arguments, control flow that misses a case from the stated requirement.

### 3. Security

- **Injection**: SQL, NoSQL, XSS, command, path traversal via unsanitized user input.
- **Auth / authz**: new endpoints missing authentication, authorization, or tenant isolation checks.
- **Sensitive data exposure**: secrets, tokens, PII logged, returned in responses, or committed to source.
- **Dependency changes**: new or upgraded packages — check for known vulnerabilities, typosquats, suspicious maintainers.

### 4. Architecture & Design

- **Layering**: route / application / domain / infra separation respected; no domain logic in routes, no DB details leaking into domain.
- **Dependency injection**: new classes wire dependencies via constructor/DI; avoid `new X(...)` or hidden globals in business code.
- **Duplicated logic**: if a utility looks generic, check whether it already exists elsewhere in the repo before recommending a local re-implementation.
- **Contract consistency**: input types match what the entity actually stores; flag dead fields (input carries properties the entity never reads).

### 5. Performance

- **N+1 queries**; repeated DB / RPC calls inside a loop that could be batched.
- **Unnecessary allocations** in hot paths (large spreads, repeated JSON (de)serialization, regex compiled per call).
- **Inefficient algorithms** where the realistic data scale matters.
- **Unbounded reads**: queries / iterations without limits where the dataset can grow.

### 6. Naming & Readability

- Variable, function, and class names should be self-descriptive and consistent with neighboring files.
- Singular / plural mismatches (e.g. `const episode = arr.map(...)` for an array).
- Class name vs. file name word-order drift.
- Dead code, misleading comments, overly terse identifiers.

### 7. Complexity

- Deeply nested conditionals, overly long functions, god-class patterns.
- Suggest extraction of helpers or early returns where applicable.
- Hardcoded magic values (IDs, URLs, thresholds) — recommend moving to config / constants / shared enums.

### 8. Error Handling

- Silently swallowed errors (empty `catch`, `.catch(() => {})` without rethrow / log).
- Thrown errors should include meaningful messages and identifying context (which entity, which input).
- Use domain-specific error types at API boundaries; avoid leaking stack traces or internal paths to clients.

### Category labels

Use one of these exact strings for `category`:
`Scope` · `Correctness` · `Type Safety` · `Security` · `Architecture` · `Performance` · `Naming` · `Complexity` · `Error Handling`
