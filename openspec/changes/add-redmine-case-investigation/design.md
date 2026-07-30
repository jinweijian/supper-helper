## Context

super-helper 已有通用 MCP Client、workspace/tool allowlist、Knowledge-first 诊断、Experience 复用、Claude Code Worker、Evidence Review 和同步/异步 Gateway。现有 Runtime 采用 Experience → Knowledge → MCP → Worker 的串行早停；通用 MCP 一次只按配置顺序调用工具，不能表达历史案例调查的两阶段协议。

Redmine 既包含有价值的历史根因、排查过程和解决动作，也包含人员身份、私有备注、附件和可能过时的结论。历史工单只能作为证据源，不能直接成为当前问题的最终诊断。完整产品设计见 `docs/superpowers/specs/2026-07-31-redmine-mcp-case-investigation-design.md`，逐步实施计划见 `docs/superpowers/plans/2026-07-31-redmine-mcp-case-investigation.md`。

当前没有可用于开发的真实 Redmine URL 或凭证，因此实现和默认验收必须完全基于 fixture/fake fetch/MCP transport；真实联调作为显式部署步骤。

## Goals / Non-Goals

**Goals:**

- 用独立、只读、最小权限的 Redmine MCP 对接历史工单。
- 让模型根据 AnswerGoal 和当前 Case 语义决定是否进行案例调查，不使用关键词触发器。
- 并行采集 Knowledge 与 Redmine，完成搜索 10 条、模型选择 3 条、读取详情的受限流程。
- 比较历史症状、根因、排查方向与当前环境；当前证据不足时由模型决定是否运行一次只读 Worker。
- 用确定性门禁保证同因判断同时引用当前证据和本轮历史工单证据。
- 保持现有 Gateway response shape、旧配置、旧 Case JSON 和普通快速路径兼容。
- 全程限制、匿名化和脱敏数据，提供可观察但不泄密的异步进度。

**Non-Goals:**

- 不创建、更新、评论、关闭或删除 Redmine 工单。
- 不下载或解析附件正文。
- 不把全部 Redmine 工单同步到 Knowledge。
- 不让 MCP 或 Worker 直接生成用户最终回复。
- 不仅凭相似工单确认当前根因。
- 不在本 change 同时实现 Jira、禅道或其他工单 adapter。
- 不要求真实 Redmine 环境进入默认 CI。

## Decisions

### 1. Redmine MCP 是独立进程

新增 `src/mcp-servers/redmine/`，通过第二个 package bin `super-helper-redmine-mcp` 启动。该模块只依赖 MCP SDK、Zod、Node 标准库和自身 Redmine REST adapter，不导入 Runtime、Gateway、Worker、Session 或 Knowledge。

这样可以在开发环境使用 stdio、生产环境使用内网 Streamable HTTP，并把 API Key、项目映射和私有备注策略留在服务端安全边界。

**Alternatives considered:**

- 把 Redmine API 调用直接写入 Runtime：会让 Runtime 持有协议、凭证和 HTTP 细节，违反模块边界。
- 复用 `src/knowledge/redmine-card.ts`：该模块属于离线 Knowledge 导入，包含知识卡转换职责，不能承担实时 API adapter。
- 用 Skill 连接 Redmine：Skill 适合流程指导，不适合稳定的认证、权限、schema 和 transport 合同。

### 2. MCP 只暴露两个只读工具

- `redmine_search_issues`：接收模型生成的 query/signals 和 workspace 已授权的 project aliases，最多返回 10 条候选。
- `redmine_get_issue_case_details`：接收 `searchId`、最多 3 个候选 issue IDs 和字段 include 列表。

详情调用必须携带第一步返回的 `searchId`。服务端保存短 TTL 的 `searchId → candidate IDs` 授权；详情 ID 不在候选集、授权过期或超过 3 条时，在发出 Redmine 请求前拒绝。

`searchId` 是必要的服务端约束，因为通用 MCP Client 每次调用可重建连接，HTTP transport 也不能依赖会话内内存上下文来证明详情 ID 来自本轮搜索。

### 3. Redmine adapter 固定 GET、base URL 和搜索 backend

Client 只提供内部 GET 方法，固定 base URL，只把 API Key 放入 `X-Redmine-API-Key`。工具输入不能提供 URL、method、headers 或凭证。

支持两个启动时冻结的 backend：

- `rest_search`：调用 `/search.json` 搜索，再受控读取候选 issue 验证数值项目 ID。
- `issues_scan`：按允许项目调用 `/issues.json`，显式 `status_id=*`，有界分页和历史窗口，再对模型生成的 query/signals 做本地词法召回。

backend 在启动 smoke/配置中确定，请求期间不临时猜测或静默切换。这样失败语义稳定，也防止每次请求因权限或版本差异走不同范围。

### 4. 隐私归一化先于 MCP 输出

只返回字段白名单：

- 候选：issue ID、项目 alias、subject、description excerpt、状态、tracker、priority、fixed version、时间和 source locator。
- 详情：允许的 facts、description/custom fields/journals/status transitions/relations/attachment metadata evidence blocks。

人员标识使用服务进程 salt 生成稳定匿名 ID；私有备注默认删除，只能由服务启动配置和 workspace policy 同时允许；附件只返回文件名、MIME、大小和时间，不返回下载 URL、token 或正文。

结构化输出最大 48,000 字符，通过删除完整旧 journal block、附件 metadata 和最终 Unicode 文本收缩实现，不能对 JSON 字符串直接切片。通用 MCP 继续使用现有 20,000 字符路径。

### 5. 模型负责语义判断，Runtime 负责预算和权限

新增四个 Product Agent：

- Evidence Source Planner
- Historical Case Analyzer（同时为候选重排提供行为约束）
- Current Evidence Assessor
- Historical Case Verifier

所有 Agent 都登记在 `src/agents/registry.json`，`mayProduceUserFacingText=false`。模型输出使用严格 JSON schema；Runtime 只做 schema、allowlist、数量、超时、只读操作和 evidence ID 验证。

Planner 不使用代码关键词。如果模型失败、超时或输出非法，Runtime 生成唯一的保守 fallback：Knowledge 正常查询，Redmine 对 workspace 全部允许项目执行一次搜索，query 使用 `answerGoal.resolvedQuestion`，signals 为空，限制仍为 10→3。

### 6. 案例调查是专用 Runtime collaborator

新增 `CaseInvestigationTurnService.tryAnswer()`，在 Preflight 成功后、Experience 早停前调用：

```text
Planner
  ├─ fast_answer → 返回 undefined，继续旧快速路径
  └─ case_investigation
       → Knowledge / Redmine 并行采证
       → Experience 候选采证
       → Analyzer
       → Current Evidence Assessor
       → 可选单次 read-only Worker
       → Verifier
       → deterministic historical-case gate
       → 一次 Review / Presentation / complete
```

不直接在 `DiagnosticRuntime` 中堆 `Promise.all`。现有 Knowledge、Experience、Worker service 都混合了采证、Run、Review 和 Presentation；专用 collaborator 通过新的 collect 方法取得证据，避免重复 Run、重复回复和提前结束。

### 7. Knowledge 与完整 Redmine 分支并行

`ParallelSourceCollector` 使用 `Promise.allSettled` 同时启动：

- Knowledge branch
- Redmine branch：search → model rerank → details

每个来源返回 `completed | no_hit | timeout | failed | not_planned`，来源失败彼此独立；timeout/failed 不得转换成 no_hit。collector 等待 barrier 后才进入 Analyzer，任何快来源不得提前完成用户回合。

### 8. 调查状态仅在当前 turn 内存在

Planner 原始 reason、工单详情、Analyzer reason、verification plan 和 Verifier reasoning 只存在于 turn-local `CaseInvestigationState`。最终 Run 只持久化：

- 经过安全裁剪的 `DiagnosticRequest`
- 经过 Review 的 `DiagnosticResult`
- 已选 evidence/claim IDs
- 安全来源状态和事件

不新增持久化 `context.caseInvestigation`。这样避免 `/api/session`、`/api/logs` 和 FileMemoryStore 通过完整 Run 暴露内部材料，也无需 Case JSON 迁移。

### 9. Worker 使用 ephemeral request 与 sanitized persisted request

需要当前证据时，Assessor 输出结构化只读验证计划，必须同时包含预期匹配与预期不匹配检查。Runtime 确定性验证 action allowlist 后：

- `workerRequest` 包含有界验证计划，只传给 Worker。
- `persistedRequest` 删除 Redmine 正文、模型 reason 和验证计划，写入正式 Run。

案例调查 Worker 最多运行一次，不执行通用 deep-query follow-up，不查询 Redmine，不做同因分类，不触发 Review/Presentation。现有普通 `diagnose()` 行为和一次 follow-up 保持不变。

### 10. 同因结论有独立确定性门禁

Verifier 先输出结构化 relation 和 evidence IDs，随后 `historical-case-gate.ts` 检查：

- 至少一个本轮有效 `workspace` 或 `log` coverage evidence。
- 至少一个本轮有效、read-only、allowlisted、completed 的 Redmine `mcp` coverage evidence。
- 引用 ID 存在于当前结果与当前 run envelopes。
- 没有关键冲突或 Worker 反证。
- Redmine 来源不是 timeout/failed。

用户陈述、Knowledge、Experience、旧 Run 或只有历史相似度都不能充当当前证据。门禁失败时降级为 `diagnostic_lead_only`，保留有证据的初步排查方向，并把稳定 blocker 交给既有 Review；Presentation 只能表达冻结的 accepted primary claims。

### 11. 复用现有异步 Gateway 和 Dashboard

Dashboard 已使用 `async:true → 202 → session polling`，无需新增 route、DTO 或状态机。同步 API 继续等待同一 Runtime pipeline，保持兼容。

新增安全 lifecycle events 和 phase label。Agent 高层事件带真实 Agent identity；Redmine 调用仍标记为 `actor='mcp'`。event detail 只记录状态、耗时、数量、选择的 issue IDs 和 evidence IDs，不记录 query/signals/body/人员/URL/token/reason/raw error。

## Risks / Trade-offs

- **[模型可能误触发或漏触发案例调查]** → 使用严格 schema、可观察阶段、受限 fallback 和离线 fixture；触发不提升结论置信度。
- **[历史工单相似但已过时]** → Analyzer 比较版本/配置/冲突，Verifier 必须结合当前证据，同因有确定性双侧门禁。
- **[Redmine Search API 在实例中不可用]** → 提供启动时冻结的 `issues_scan` backend，不在请求中扩大范围或动态切换。
- **[扫描 backend 产生负载]** → 项目 allowlist、历史窗口、每项目页数、每页大小、总超时和 5 分钟进程缓存全部有界。
- **[MCP 两次调用越权读取任意 issue]** → `searchId` 候选授权、TTL、最多 3 条和项目二次校验。
- **[工单内容或内部模型状态泄漏到 Case/API]** → turn-local state、sanitized persisted request、事件 detail 白名单和 API 泄漏测试。
- **[Knowledge/Redmine 并行造成共享 request 竞态]** → collect 返回独立 outcome/context patch，由 aggregator 在 barrier 后统一组合，不并发修改 `DiagnosticRequest`。
- **[重构 collect 破坏旧快速路径]** → `answer()`/`diagnose()` 作为兼容薄包装，专项与全量回归同时验证。
- **[48K 历史详情超出模型有效上下文]** → MCP 先结构化收缩，Analyzer 读取有界详情，最终 Coverage 只接收实际引用且单块受限的 evidence。
- **[HTTP MCP 服务被未授权访问]** → 生产 transport 可配置独立 Bearer token；它与 Redmine API Key 分离，二者都不进入工具 schema。

## Migration Plan

1. 合并可选配置合同、MCP capability 和旧配置兼容验证；此时功能默认关闭。
2. 部署离线可测的 Redmine MCP Server；开发使用 stdio fixture。
3. 在测试 workspace 增加 MCP server、两个 tool allowlist、historicalCaseSources 和项目 alias。
4. 启用 Runtime 案例调查分支，先观察安全事件与来源状态。
5. 在测试 Redmine 环境执行显式真实验收，确认 read-only 账号、backend、项目范围、隐私与负载。
6. 生产部署内网 HTTP MCP，配置 transport Bearer 和专用 Redmine read-only API Key。
7. 分 workspace 灰度添加 historicalCaseSources。

回滚不需要数据迁移：从 workspace 删除 `historicalCaseSources` 或禁用 MCP server 后，Planner 看不到历史来源，Runtime 自动保留旧快速路径；Redmine MCP 进程可独立停止。

## Open Questions

没有阻塞实现的问题。真实 Redmine 地址、项目 alias→数值 ID、实例支持的搜索 backend、私有备注开关和生产凭证在部署联调阶段由用户提供，不影响离线实现。
