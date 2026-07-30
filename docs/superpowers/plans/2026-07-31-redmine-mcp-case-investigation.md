# Redmine MCP 历史案例调查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 super-helper 增加只读 Redmine MCP，并让模型驱动的案例调查流程并行使用 Knowledge、历史工单和可选 Workspace Worker，在确定性证据门禁后给出结论。

**Architecture:** Redmine MCP 作为独立进程实现，负责 Redmine REST 协议、项目 allowlist、隐私归一化和两个只读工具；主应用通过现有 MCP Client 调用它。Runtime 新增 `CaseInvestigationTurnService`，在 Preflight 后先由模型选择快速路径或案例调查路径，案例路径并行采集 Knowledge 与 Redmine，完成候选重排、历史案例分析、当前证据评估、可选 Worker 验证和同因门禁，最终只进行一次 Review/Presentation。

**Tech Stack:** TypeScript 5.8、Node.js 20.19+、`@modelcontextprotocol/sdk` 1.29.0、Zod 4、原生 `fetch`、Vue 3、Node test runner、Vitest、OpenSpec。

## Global Constraints

- 设计权威文件：`docs/superpowers/specs/2026-07-31-redmine-mcp-case-investigation-design.md`。
- 执行前 OpenSpec change `add-redmine-case-investigation` 必须达到 apply-ready。
- 模型决定是否查询历史工单；Runtime 不维护关键词触发器、问题类型枚举或中文问法列表。
- Planner 失败、超时或结构非法时，最多执行一次有界只读 Redmine 兜底查询。
- Knowledge 与完整 Redmine 分支必须并行启动；任何单一来源都不得提前完成回合。
- Redmine 搜索最多返回 10 条候选，模型最多选择 3 条，本轮详情只能读取搜索候选中的 issue ID。
- “可能相同根因”必须同时引用当前 `workspace`/`log` 证据和本次 Redmine `mcp` 证据；用户陈述、历史相似度和 Knowledge 不能替代当前证据。
- Worker 只执行结构化只读验证计划，不查询 Redmine，不负责最终同因判断，不直接回复用户。
- MCP Server 只允许 GET；不创建、更新、评论、关闭或删除工单，不下载附件正文。
- API Key 只通过 `X-Redmine-API-Key` 发送；人员身份匿名化，附件只保留元数据，私有备注只能由服务启动配置开启。
- Runtime、Gateway、Worker、Session、Agent、Observability 的职责必须遵守 `docs/standards/module-boundaries.md`。
- 不改变 `/api/chat`、`/api/session`、`/api/sessions`、`/api/logs` 的顶层 response shape。
- 不把 Redmine 原始正文、Planner/Analyzer/Verifier reason、验证计划、凭证、人员身份或原始错误持久化到 Case JSON 或公共 DTO。
- 默认测试全部离线；真实 Redmine 联调只能通过显式脚本运行，不能进入 `pnpm test`。
- 每个生产代码任务严格执行 Red-Green-Refactor；测试必须先失败，再写最小实现。

---

## 文件结构与职责

### 新增 Redmine MCP Server

```text
src/mcp-servers/redmine/
  main.ts                              # 薄可执行入口；只解析配置并选择 transport
  config.ts                            # 环境变量和启动配置解析
  contracts.ts                         # MCP 工具输入/输出 Zod schema 与稳定类型
  candidate-grants.ts                  # searchId → issueIds 的进程内 TTL 授权
  server.ts                            # 创建 McpServer 并注册两个工具
  redmine-api/
    protocol.ts                        # Redmine REST 原始响应 schema
    errors.ts                          # HTTP/超时错误到安全错误码的映射
    client.ts                          # 固定 base URL、API Key、GET-only 请求
    search.ts                          # rest_search / issues_scan、分页、缓存与 backend 冻结
    normalizer.ts                      # 项目映射、身份匿名、私有备注和附件元数据
    bounding.ts                        # 完整 evidence block 的 48,000 字符结构化收缩
  tools/
    search-issues.ts                   # redmine_search_issues
    get-issue-case-details.ts          # redmine_get_issue_case_details
  transports/
    stdio.ts                           # StdioServerTransport
    http.ts                            # StreamableHTTPServerTransport 与 Bearer 门禁
```

### 新增主应用历史案例 MCP 边界

```text
src/mcp/
  historical-case-normalizer.ts        # schema-aware 48K 结果归一化
  historical-case-evidence-service.ts  # 两次有界 MCP 调用和 provenance 转换
```

### 新增 Runtime 案例调查边界

```text
src/runtime/case-investigation/
  contracts.ts                         # 全流程内部类型，不进入公共 DTO
  evidence-source-planner-service.ts   # 模型路由与保守 fallback
  historical-case-reranker-service.ts  # 从 10 个候选选择 3 个 ID
  parallel-source-collector.ts         # Knowledge/Redmine allSettled 编排
  historical-case-analyzer-service.ts  # 历史案例关系、假设和只读验证计划
  current-evidence-assessor-service.ts # 是否需要 Worker 的模型判断
  historical-case-verifier-service.ts  # 结构化比较当前与历史证据
  historical-case-gate.ts              # 同因的确定性双侧证据门禁
  case-investigation-result.ts          # 将已验证结论转换为 DiagnosticResult
  case-investigation-turn-service.ts    # 整个案例调查回合的唯一编排入口
```

### 新增 Product Agent 配置

```text
src/agents/evidence-source-planner.md
src/agents/historical-case-analyzer.md
src/agents/current-evidence-assessor.md
src/agents/historical-case-verifier.md
```

`historical-case-reranker-service.ts` 复用 `historical-case-analyzer.md` 的“候选选择”合同，不增加第五个产品 Agent 身份。

---

### Task 1: 固化历史案例配置与通用 MCP capability 合同

**Files:**
- Create: `test/historical-case-config.test.mjs`
- Modify: `src/mcp/contracts.ts`
- Modify: `src/config/contracts.ts`
- Modify: `src/contracts/base.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/io.ts`
- Modify: `src/onboarding/config-commit.ts`
- Modify: `test/onboarding.test.mjs`

**Interfaces:**
- Consumes: 现有 `McpServerConfig`、`WorkspaceConfig`、`SuperHelperConfig`。
- Produces:

```ts
export interface HistoricalCaseProjectConfig {
  alias: string;
  redmineProjectId: number;
}

export interface HistoricalCaseSourceConfig {
  serverId: string;
  projectAliases: string[];
  includePrivateNotes?: boolean;
}

export interface HistoricalCaseMcpServerCapability {
  type: 'historical_case';
  provider: 'redmine';
}
```

- `McpServerBase.capability?: HistoricalCaseMcpServerCapability`
- `WorkspaceConfig.historicalCaseSources?: HistoricalCaseSourceConfig[]`
- `SuperHelperConfig.workspaces[*].historicalCaseSources?: HistoricalCaseSourceConfig[]`
- 历史配置缺少这些字段时行为保持不变。

- [ ] **Step 1: 写配置 round-trip、旧配置兼容和 onboarding 保留字段的失败测试**

```js
test('historical case config round-trips without changing legacy workspaces', () => {
  const config = defaultConfig();
  config.mcpTools.push({
    id: 'company-redmine',
    name: 'Company Redmine',
    protocol: 'http',
    permission: 'read_only',
    enabled: true,
    allowedToolNames: ['redmine_search_issues', 'redmine_get_issue_case_details'],
    capability: { type: 'historical_case', provider: 'redmine' },
    config: { url: 'http://127.0.0.1:8787/mcp', headers: {} },
  });
  config.workspaces[0].historicalCaseSources = [{
    serverId: 'company-redmine',
    projectAliases: ['training'],
    includePrivateNotes: false,
  }];
  const loaded = loadConfig(writeConfigFixture(config));
  assert.deepEqual(loaded.workspaces[0].historicalCaseSources, config.workspaces[0].historicalCaseSources);
  assert.deepEqual(loaded.mcpTools.at(-1).capability, { type: 'historical_case', provider: 'redmine' });
});
```

同时断言：

- 旧 workspace 没有 `historicalCaseSources` 时可读。
- onboarding 更新 rootPath/mcpToolIds 后保留 `historicalCaseSources`。
- source 引用未知 server、非 `read_only` server、缺两个工具 allowlist 或空 projectAliases 时 `loadConfig` 拒绝。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/historical-case-config.test.mjs test/onboarding.test.mjs`

Expected: FAIL，首次失败应指出 `historicalCaseSources`/`capability` 未被解析或被 onboarding 丢弃。

- [ ] **Step 3: 增加可选合同和确定性配置校验**

在 `src/config/io.ts` 的已有配置归一化入口增加以下约束：

```ts
function validateHistoricalCaseSources(config: SuperHelperConfig): void {
  for (const workspace of config.workspaces) {
    for (const source of workspace.historicalCaseSources ?? []) {
      const server = config.mcpTools.find((item) => item.id === source.serverId);
      if (!server) throw new Error(`historical case server not found: ${source.serverId}`);
      if (server.permission !== 'read_only') throw new Error(`historical case server must be read_only: ${source.serverId}`);
      if (server.capability?.type !== 'historical_case') throw new Error(`historical case capability missing: ${source.serverId}`);
      const required = ['redmine_search_issues', 'redmine_get_issue_case_details'];
      if (!required.every((name) => server.allowedToolNames?.includes(name))) {
        throw new Error(`historical case tools not allowlisted: ${source.serverId}`);
      }
      if (source.projectAliases.length === 0) throw new Error(`historical case projectAliases empty: ${source.serverId}`);
    }
  }
}
```

`src/onboarding/config-commit.ts` 重建 workspace 时显式复制：

```ts
historicalCaseSources: existing?.historicalCaseSources,
```

- [ ] **Step 4: 运行专项测试和类型检查**

Run: `pnpm build && node --test test/historical-case-config.test.mjs test/onboarding.test.mjs && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/mcp/contracts.ts src/config/contracts.ts src/contracts/base.ts src/config/defaults.ts src/config/io.ts src/onboarding/config-commit.ts test/historical-case-config.test.mjs test/onboarding.test.mjs
git commit -m "feat: add historical case source configuration"
```

---

### Task 2: 实现 Redmine GET-only API Client 与固定搜索后端

**Files:**
- Create: `src/mcp-servers/redmine/contracts.ts`
- Create: `src/mcp-servers/redmine/redmine-api/protocol.ts`
- Create: `src/mcp-servers/redmine/redmine-api/errors.ts`
- Create: `src/mcp-servers/redmine/redmine-api/client.ts`
- Create: `src/mcp-servers/redmine/redmine-api/search.ts`
- Create: `test/redmine-api-client.test.mjs`
- Create: `test/fixtures/redmine/issues-page.json`
- Create: `test/fixtures/redmine/search-results.json`

**Interfaces:**
- Consumes: 原生 `fetch` 和 Redmine JSON。
- Produces:

```ts
export type ResolvedSearchBackend = 'rest_search' | 'issues_scan';

export interface RedmineApiPort {
  readonly searchBackend: ResolvedSearchBackend;
  searchIssues(input: RedmineSearchInput, signal?: AbortSignal): Promise<RedmineIssueCandidate[]>;
  getIssueDetails(issueId: number, signal?: AbortSignal): Promise<RedmineRawIssue>;
}

export function createRedmineApiClient(input: {
  baseUrl: string;
  apiKey: string;
  projectByAlias: ReadonlyMap<string, number>;
  searchBackend: ResolvedSearchBackend;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  scan: { maxPagesPerProject: number; pageSize: number; updatedWithinDays: number; cacheTtlMs: number };
}): RedmineApiPort;
```

- [ ] **Step 1: 写 API Key、GET-only、URL 固定、项目过滤、分页和 backend 冻结的失败测试**

测试必须捕获全部 fetch 调用并断言：

```js
assert.equal(call.method, 'GET');
assert.equal(call.headers.get('X-Redmine-API-Key'), 'redmine-test-key');
assert.equal(call.headers.has('Authorization'), false);
assert.equal(new URL(call.url).origin, 'https://redmine.invalid');
assert.equal(new URL(call.url).searchParams.get('status_id'), '*');
```

覆盖：

- `rest_search` 调 `/search.json?q=...&issues=1`，随后受控读取候选 issue 来验证数值项目 ID。
- `issues_scan` 对每个允许项目调 `/issues.json?project_id=<id>&status_id=*&sort=updated_on:desc`。
- 两个 backend 最终最多返回 input.limit 个候选。
- `issues_scan` 最多 `maxPagesPerProject` 页并在缓存 TTL 内不重复 fetch。
- 启动时确定 backend；请求期间 `/search.json` 失败不会静默切换 backend。
- 任意非 GET 方法、绝对 URL 输入或 allowlist 外 issue ID 在发出请求前拒绝。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/redmine-api-client.test.mjs`

Expected: FAIL，首次失败应为模块不存在。

- [ ] **Step 3: 实现严格 REST schema、安全错误和 backend**

错误只暴露稳定码：

```ts
export type RedmineSafeErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'invalid_response'
  | 'transport_failure';
```

请求函数固定拼接 `new URL(relativePath, normalizedBaseUrl)`，并拒绝 `relativePath` 不是 `/` 开头或含 origin。`AbortController` 与传入 signal 合并，超时后抛 `RedmineApiError('timeout')`。搜索只对模型提供的 `query`/`signals` 做召回和排序，不包含“是否触发 Redmine”判断。

- [ ] **Step 4: 运行专项测试**

Run: `pnpm build && node --test test/redmine-api-client.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/mcp-servers/redmine/contracts.ts src/mcp-servers/redmine/redmine-api test/redmine-api-client.test.mjs test/fixtures/redmine/issues-page.json test/fixtures/redmine/search-results.json
git commit -m "feat: add read-only Redmine API adapter"
```

---

### Task 3: 实现 Redmine 隐私归一化与结构化预算

**Files:**
- Create: `src/mcp-servers/redmine/redmine-api/normalizer.ts`
- Create: `src/mcp-servers/redmine/redmine-api/bounding.ts`
- Create: `test/redmine-normalizer.test.mjs`
- Create: `test/fixtures/redmine/issue-private-notes.json`
- Reuse: `test/fixtures/redmine/issue-12345.json`

**Interfaces:**
- Produces:

```ts
export function normalizeIssueCandidate(
  issue: RedmineRawIssue,
  projectAlias: string,
): RedmineIssueCandidate;

export function normalizeIssueCase(input: {
  issue: RedmineRawIssue;
  projectAlias: string;
  includePrivateNotes: boolean;
  include: HistoricalCaseDetailInclude[];
}): RedmineIssueCase;

export function boundHistoricalCaseDetails(
  cases: readonly RedmineIssueCase[],
  maxChars?: number,
): { cases: RedmineIssueCase[]; truncated: boolean };
```

- [ ] **Step 1: 写身份匿名、私有备注、附件元数据和完整 block 收缩的失败测试**

关键断言：

```js
assert.doesNotMatch(serialized, /张三|zhangsan@example\.com|10\.0\.0\.8/);
assert.match(serialized, /user_[a-f0-9]{12}/);
assert.equal(result.cases[0].attachments[0].contentUrl, undefined);
assert.equal(result.cases[0].attachments[0].filename, 'diagnostic.log');
assert.ok(JSON.stringify(result).length <= 48_000);
for (const block of result.cases.flatMap((item) => item.evidenceBlocks)) {
  assert.ok(block.evidenceId && block.kind && block.text);
}
```

分别验证 `includePrivateNotes=false` 删除 private journal，`true` 才保留；两个模式都必须匿名 author/assignee/observer。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/redmine-normalizer.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现字段白名单、稳定匿名 ID 和结构化收缩**

匿名 ID 使用进程内 salt 与规范化 user ID 的 SHA-256 前 12 位：

```ts
function anonymousUserId(value: string, salt: string): string {
  return `user_${createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 12)}`;
}
```

48K 收缩顺序固定为：

1. 保留 facts 和每个 case 至少一个 description/resolution block。
2. 按更新时间倒序删除最旧 journal blocks。
3. 删除多余 attachment metadata。
4. 对仍超预算的单个 text 按 Unicode code point 截断并记录 `truncatedFields`。
5. 永远不对序列化 JSON 字符串直接 `.slice()`。

- [ ] **Step 4: 运行专项测试**

Run: `pnpm build && node --test test/redmine-normalizer.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/mcp-servers/redmine/redmine-api/normalizer.ts src/mcp-servers/redmine/redmine-api/bounding.ts test/redmine-normalizer.test.mjs test/fixtures/redmine/issue-private-notes.json
git commit -m "feat: normalize bounded Redmine case evidence"
```

---

### Task 4: 实现两个 Redmine MCP 工具、候选授权和双 transport

**Files:**
- Create: `src/mcp-servers/redmine/candidate-grants.ts`
- Create: `src/mcp-servers/redmine/tools/search-issues.ts`
- Create: `src/mcp-servers/redmine/tools/get-issue-case-details.ts`
- Create: `src/mcp-servers/redmine/server.ts`
- Create: `src/mcp-servers/redmine/config.ts`
- Create: `src/mcp-servers/redmine/transports/stdio.ts`
- Create: `src/mcp-servers/redmine/transports/http.ts`
- Create: `src/mcp-servers/redmine/main.ts`
- Create: `test/redmine-mcp-server.test.mjs`
- Create: `test/redmine-mcp-transports.test.mjs`
- Create: `test/redmine-mcp-config.test.mjs`
- Modify: `package.json`
- Modify: `test/web-build-contract.test.mjs`

**Interfaces:**
- Produces:

```ts
export interface CandidateGrantStore {
  create(issueIds: readonly number[], ttlMs: number): string;
  assertAllowed(searchId: string, issueIds: readonly number[]): void;
}

export function createRedmineMcpServer(input: {
  api: RedmineApiPort;
  projects: readonly HistoricalCaseProjectConfig[];
  includePrivateNotes: boolean;
  grants: CandidateGrantStore;
}): McpServer;

export function runStdioTransport(server: McpServer): Promise<void>;

export function startHttpTransport(input: {
  createServer: () => McpServer;
  host: string;
  port: number;
  bearerToken?: string;
}): Promise<{ url: string; close(): Promise<void> }>;
```

工具合同：

```ts
export const SearchIssuesInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  signals: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  projectAliases: z.array(z.string().trim().min(1)).min(1).max(10),
  statuses: z.array(z.enum(['open', 'closed'])).min(1).default(['open', 'closed']),
  updatedAfter: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(10).default(10),
});

export const GetIssueCaseDetailsInputSchema = z.object({
  searchId: z.string().uuid(),
  issueIds: z.array(z.number().int().positive()).min(1).max(3),
  include: z.array(z.enum([
    'description', 'custom_fields', 'journals', 'status_transitions',
    'relations', 'attachment_metadata',
  ])).min(1),
});
```

- [ ] **Step 1: 写工具合同、searchId 授权、transport 一致性和配置失败测试**

必须验证：

- Server 恰好暴露 `redmine_search_issues` 与 `redmine_get_issue_case_details`。
- 搜索返回 `{ searchId, candidates, truncated }`。
- 未知/过期 `searchId`、超过 3 个 ID、非本轮候选 ID 在 API 详情 fetch 前拒绝。
- stdio 与 HTTP 的 tool schema 一致。
- HTTP 无/错 Bearer token 返回 401，正确 token 可以 initialize/list/call。
- 缺 base URL、API Key、项目映射、非法数值预算时启动失败，错误不包含 secret。
- `package.json.bin["super-helper-redmine-mcp"] === "./dist/mcp-servers/redmine/main.js"`。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/redmine-mcp-server.test.mjs test/redmine-mcp-transports.test.mjs test/redmine-mcp-config.test.mjs test/web-build-contract.test.mjs`

Expected: FAIL，首先报告 MCP Server 模块或第二个 bin 不存在。

- [ ] **Step 3: 实现工具与进程入口**

`main.ts` 只做：

```ts
#!/usr/bin/env node
const config = loadRedmineMcpConfig(process.env, process.argv.slice(2));
const createServer = () => createConfiguredRedmineMcpServer(config);
if (config.transport === 'stdio') {
  await runStdioTransport(createServer());
} else {
  await startHttpTransport({ createServer, host: config.host, port: config.port, bearerToken: config.bearerToken });
}
```

配置支持：

- `REDMINE_BASE_URL`
- `REDMINE_API_KEY`
- `REDMINE_PROJECTS_JSON`，值为 `[{"alias":"training","redmineProjectId":101}]`
- `REDMINE_SEARCH_BACKEND=rest_search|issues_scan`
- `REDMINE_INCLUDE_PRIVATE_NOTES=true|false`
- `REDMINE_MCP_TRANSPORT=stdio|http`
- `REDMINE_MCP_HOST`、`REDMINE_MCP_PORT`、`REDMINE_MCP_BEARER_TOKEN`
- 有界的 timeout、scan pages、page size、history days、cache/grant TTL。

- [ ] **Step 4: 运行专项测试和构建**

Run: `pnpm build && node --test test/redmine-mcp-server.test.mjs test/redmine-mcp-transports.test.mjs test/redmine-mcp-config.test.mjs test/web-build-contract.test.mjs`

Expected: PASS，且 `dist/mcp-servers/redmine/main.js` 存在。

- [ ] **Step 5: 提交**

```bash
git add src/mcp-servers/redmine package.json test/redmine-mcp-server.test.mjs test/redmine-mcp-transports.test.mjs test/redmine-mcp-config.test.mjs test/web-build-contract.test.mjs
git commit -m "feat: expose Redmine read-only MCP server"
```

---

### Task 5: 增加 historical_case schema-aware MCP 执行路径

**Files:**
- Create: `src/mcp/historical-case-normalizer.ts`
- Create: `src/mcp/historical-case-evidence-service.ts`
- Modify: `src/mcp/policy.ts`
- Modify: `src/mcp/index.ts`
- Modify: `test/mcp-runtime.test.mjs`
- Create: `test/historical-case-evidence-service.test.mjs`

**Interfaces:**
- Produces:

```ts
export interface HistoricalCaseEvidencePort {
  search(input: HistoricalCaseSearchInput): Promise<HistoricalCaseSearchOutcome>;
  getDetails(input: HistoricalCaseDetailsInput): Promise<HistoricalCaseDetailsOutcome>;
}

export class HistoricalCaseEvidenceService implements HistoricalCaseEvidencePort {
  constructor(config: SuperHelperConfig, options?: McpEvidenceServiceOptions);
  search(input: HistoricalCaseSearchInput): Promise<HistoricalCaseSearchOutcome>;
  getDetails(input: HistoricalCaseDetailsInput): Promise<HistoricalCaseDetailsOutcome>;
}
```

`HistoricalCaseSearchOutcome`/`DetailsOutcome` 使用 `completed | no_hit | timeout | failed`，并包含安全 `reason`、结构化 payload、`Evidence[]` 和 `CoverageEvidenceEnvelope[]`。

- [ ] **Step 1: 写 48K JSON 完整性、两次调用参数和状态映射的失败测试**

关键断言：

```js
assert.doesNotThrow(() => JSON.parse(execution.result.structuredContent));
assert.ok(execution.result.structuredContent.length <= 48_000);
assert.equal(searchCall.arguments.limit, 10);
assert.deepEqual(detailsCall.arguments.issueIds, [12345, 12888, 13102]);
assert.equal(timeoutOutcome.status, 'timeout');
assert.equal(noHitOutcome.status, 'no_hit');
assert.notEqual(timeoutOutcome.status, noHitOutcome.status);
```

还要断言 historical-case payload 即使包含名为 `superHelperEvidence` 的字段也不会走通用 MCP 直答 extractor。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/mcp-runtime.test.mjs test/historical-case-evidence-service.test.mjs`

Expected: FAIL，48K structured content 被现有 20K 字符切断或 service 不存在。

- [ ] **Step 3: 根据 capability 选择归一化器并实现专用 service**

在 `executeMcpTool()` 中只按显式 capability 分派：

```ts
const result = input.server.capability?.type === 'historical_case'
  ? normalizeHistoricalCaseMcpResult(rawResult)
  : normalizeMcpResult(rawResult);
```

专用 service 必须：

- 从 workspace `historicalCaseSources` 与 `mcpToolIds` 交集选择一个 server。
- projectAliases 与 workspace allowlist 取交集；空集合时拒绝，不扩大范围。
- search 强制 `limit=10`；details 强制 `issueIds.length<=3`。
- 不修改 `DiagnosticRequest.context.mcp`，不创建 Run，不写消息。
- 每个 evidence `kind:'mcp'`、`source:'redmine:issue:<id>#<blockId>'`。
- coverage envelope 标记 `freshness:'current_mcp_call'`、`readOnly:true`、`allowlisted:true`、`completed:true`。

- [ ] **Step 4: 运行专项测试**

Run: `pnpm build && node --test test/mcp-runtime.test.mjs test/historical-case-evidence-service.test.mjs`

Expected: PASS，legacy MCP 20K 行为保持不变。

- [ ] **Step 5: 提交**

```bash
git add src/mcp/historical-case-normalizer.ts src/mcp/historical-case-evidence-service.ts src/mcp/policy.ts src/mcp/index.ts test/mcp-runtime.test.mjs test/historical-case-evidence-service.test.mjs
git commit -m "feat: add structured historical case MCP evidence"
```

---

### Task 6: 增加四个产品 Agent 和严格模型服务

**Files:**
- Create: `src/agents/evidence-source-planner.md`
- Create: `src/agents/historical-case-analyzer.md`
- Create: `src/agents/current-evidence-assessor.md`
- Create: `src/agents/historical-case-verifier.md`
- Modify: `src/agents/registry.json`
- Modify: `src/agents/README.md`
- Modify: `src/runtime/agent-configs.ts`
- Create: `src/runtime/case-investigation/contracts.ts`
- Create: `src/runtime/case-investigation/evidence-source-planner-service.ts`
- Create: `src/runtime/case-investigation/historical-case-reranker-service.ts`
- Create: `src/runtime/case-investigation/historical-case-analyzer-service.ts`
- Create: `src/runtime/case-investigation/current-evidence-assessor-service.ts`
- Create: `src/runtime/case-investigation/historical-case-verifier-service.ts`
- Create: `test/case-investigation-model-services.test.mjs`
- Modify: `test/runtime-hardening.test.mjs`

**Interfaces:**
- Produces:

```ts
export type CaseInvestigationMode = 'fast_answer' | 'case_investigation';

export class EvidenceSourcePlannerService {
  plan(input: EvidenceSourcePlannerInput): Promise<EvidenceSourcePlan>;
}

export class HistoricalCaseRerankerService {
  select(input: HistoricalCaseRerankInput): Promise<number[]>;
}

export class HistoricalCaseAnalyzerService {
  analyze(input: HistoricalCaseAnalyzerInput): Promise<HistoricalCaseAnalysis>;
}

export class CurrentEvidenceAssessorService {
  assess(input: CurrentEvidenceAssessmentInput): Promise<CurrentEvidenceAssessment>;
}

export class HistoricalCaseVerifierService {
  verify(input: HistoricalCaseVerifierInput): Promise<HistoricalCaseVerification>;
}
```

Planner fallback 精确为：

```ts
{
  mode: 'case_investigation',
  status: 'degraded',
  sources: {
    knowledge: { enabled: true, query: answerGoal.resolvedQuestion, moduleCandidates: [] },
    redmine: {
      enabled: historicalSourceConfigured,
      query: answerGoal.resolvedQuestion,
      projectAliases: allAllowedProjectAliases,
      signals: [],
      candidateLimit: 10,
      detailLimit: 3,
    },
  },
}
```

- [ ] **Step 1: 写模型 schema、allowlist、失败降级和非法 evidence ID 的失败测试**

覆盖：

- 模型可返回 `fast_answer`，没有关键词触发逻辑。
- Planner 非法 JSON、超时、未知项目 alias 均得到上面的单次 fallback 计划。
- 有效计划的项目 alias 只能收窄，不能扩大 allowlist。
- reranker 只能从候选集合返回最多 3 个唯一 ID；非法输出得到确定性最近更新时间排序的最多 3 个 ID。
- Analyzer 的每个 matched fact、root-cause hypothesis、verification check 必须引用存在的 evidence ID；非法引用使 analysis 状态为 `invalid`。
- verification check 的 action 只能为结构化只读 `read_file | search_workspace | inspect_config | inspect_log | run_read_only_command`；出现写文件、数据库更新、工单更新时拒绝。
- Assessor 只允许 `worker_needed | worker_not_needed`，并绑定 missing current evidence。
- Verifier 不接受模型提供的新事实或未知 evidence ID。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/case-investigation-model-services.test.mjs test/runtime-hardening.test.mjs`

Expected: FAIL，新 Agent stage/config/service 不存在。

- [ ] **Step 3: 实现严格 JSON 模型服务与 Agent 配置**

`AgentStage` 增加现存遗漏和新阶段：

```ts
| 'mcp_planner'
| 'mcp_evidence_extractor'
| 'evidence_source_planner'
| 'historical_case_analyzer'
| 'current_evidence_assessor'
| 'historical_case_verifier'
```

所有新 registry 项必须：

```json
{
  "required": false,
  "mayProduceUserFacingText": false,
  "executionMode": "model_assisted"
}
```

模型服务统一使用 `parseAgentModelJson` + Zod `safeParse`；prompt 输入只包含 AnswerGoal、匿名化后的当前 facts/unknowns、可用 source/project alias、候选/证据的有界安全字段，不含 URL/token/人员身份/原始 API 错误。

- [ ] **Step 4: 运行专项测试**

Run: `pnpm build && node --test test/case-investigation-model-services.test.mjs test/runtime-hardening.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/agents src/runtime/agent-configs.ts src/runtime/case-investigation/contracts.ts src/runtime/case-investigation/evidence-source-planner-service.ts src/runtime/case-investigation/historical-case-reranker-service.ts src/runtime/case-investigation/historical-case-analyzer-service.ts src/runtime/case-investigation/current-evidence-assessor-service.ts src/runtime/case-investigation/historical-case-verifier-service.ts test/case-investigation-model-services.test.mjs test/runtime-hardening.test.mjs
git commit -m "feat: add model-driven case investigation agents"
```

---

### Task 7: 拆出无副作用的 Knowledge、Experience 与 Worker 采证接口

**Files:**
- Modify: `src/runtime/knowledge-turn.ts`
- Modify: `src/runtime/experience-turn.ts`
- Modify: `src/runtime/worker-diagnosis.ts`
- Modify: `src/runtime/worker-turn.ts`
- Create: `test/case-investigation-source-collection.test.mjs`
- Modify: `test/worker-action-contract.test.mjs`

**Interfaces:**
- Produces:

```ts
class KnowledgeTurnService {
  collect(caseSession: StoredCase, request: DiagnosticRequest, query?: string): Promise<KnowledgeSourceOutcome>;
  answer(...): Promise<RuntimeTurnResponse | undefined>;
}

class ExperienceTurnService {
  collect(caseSession: StoredCase, request: DiagnosticRequest): Promise<ExperienceSourceOutcome>;
  answer(...): Promise<RuntimeTurnResponse | undefined>;
}

class WorkerDiagnosisService {
  collectEvidence(
    caseSession: StoredCase,
    workerRequest: DiagnosticRequest,
    persistedRequest: DiagnosticRequest,
  ): Promise<WorkerEvidenceOutcome>;
  diagnose(...): Promise<ReviewPresentationResult>;
}
```

- [ ] **Step 1: 写 collect 不完成回合、共享 request 不变和安全持久化的失败测试**

关键断言：

```js
const before = structuredClone(request);
const knowledge = await service.collect(caseSession, request, '模型生成查询');
assert.deepEqual(request, before);
assert.equal(caseSession.messages.filter((m) => m.role === 'helper').length, 0);
assert.equal(caseSession.runs.length, 0);
assert.ok(knowledge.evidence.length >= 0);
```

Worker 测试必须断言：

- `worker.diagnose` 收到 expectedMatch 与 expectedMismatch 验证检查。
- 任何写操作计划在调用 Worker 前拒绝。
- 持久化 Run 的 request 不含 Redmine 正文、analysis reason、验证计划。
- collect 只执行一次，不触发 deep-query follow-up，不调用 Review/Presentation。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/case-investigation-source-collection.test.mjs test/worker-action-contract.test.mjs`

Expected: FAIL，collect 方法不存在。

- [ ] **Step 3: 将现有 answer/diagnose 重构为复用 collect 的薄包装**

`KnowledgeTurnService.collect()` 返回 diagnosis、evidence、coverage envelopes、contextPatch 和来源状态；只有 `answer()` 才应用 contextPatch、创建 Run、Review 并完成回合。`ExperienceTurnService.collect()` 同理只返回 match/rejected candidates。

`WorkerDiagnosisService.collectEvidence()`：

- 创建一个正式 Run，但 `run.request = persistedRequest`。
- 只把 `workerRequest` 传给 worker adapter。
- 应用 worker response，保存安全 trace。
- 返回 result/envelopes，不 Review、不 follow-up、不 complete。

现有 `diagnose()` 的对外行为保持不变并继续支持一次 deep-query follow-up。

- [ ] **Step 4: 运行专项测试和旧 Worker 测试**

Run: `pnpm build && node --test test/case-investigation-source-collection.test.mjs test/worker-action-contract.test.mjs test/supper-helper.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/runtime/knowledge-turn.ts src/runtime/experience-turn.ts src/runtime/worker-diagnosis.ts src/runtime/worker-turn.ts test/case-investigation-source-collection.test.mjs test/worker-action-contract.test.mjs
git commit -m "refactor: expose side-effect-free evidence collectors"
```

---

### Task 8: 实现 Knowledge 与 Redmine 并行采集及两次 Redmine 调用

**Files:**
- Create: `src/runtime/case-investigation/parallel-source-collector.ts`
- Create: `test/case-investigation-parallel.test.mjs`

**Interfaces:**
- Consumes: `KnowledgeTurnService.collect`、`HistoricalCaseEvidencePort.search/getDetails`、`HistoricalCaseRerankerService.select`。
- Produces:

```ts
export class ParallelSourceCollector {
  collect(input: {
    caseSession: StoredCase;
    request: DiagnosticRequest;
    plan: EvidenceSourcePlan;
  }): Promise<CaseInvestigationSources>;
}
```

- [ ] **Step 1: 用 deferred Promise 写真正并行和 barrier 的失败测试**

```js
const knowledgeStarted = deferred();
const redmineStarted = deferred();
const knowledgeRelease = deferred();
const redmineRelease = deferred();
const collecting = collector.collect(input);
await Promise.all([knowledgeStarted.promise, redmineStarted.promise]);
redmineRelease.resolve(searchOutcome);
await flushPromises();
assert.equal(turnCompleted, false);
knowledgeRelease.resolve(knowledgeOutcome);
const result = await collecting;
assert.equal(result.knowledge.status, 'completed');
assert.equal(result.historicalCases.status, 'completed');
```

还要覆盖：

- Redmine 搜索强制 10 条上限。
- reranker 最多返回 3 个且 ID 来自搜索候选。
- details 收到同一个 `searchId`。
- Knowledge timeout + Redmine completed、反向组合、双失败。
- `timeout`、`failed`、`no_hit`、`not_planned` 保持可区分。
- reranker/详情失败不导致 Knowledge 结果丢失。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/case-investigation-parallel.test.mjs`

Expected: FAIL，collector 不存在。

- [ ] **Step 3: 使用 allSettled 实现完整来源分支**

启动点必须是：

```ts
const [knowledgeSettled, redmineSettled] = await Promise.allSettled([
  collectKnowledgeBranch(input),
  collectRedmineBranch(input),
]);
```

`collectRedmineBranch()` 内部严格串行：

```text
search(limit=10) → rerank(max=3) → getDetails(searchId, selectedIds)
```

单个来源的 timeout 由其 adapter/service 产生；collector 只做安全状态映射和 `sourceGaps` 聚合，不把 reject 当作 `no_hit`。

- [ ] **Step 4: 运行专项测试**

Run: `pnpm build && node --test test/case-investigation-parallel.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/runtime/case-investigation/parallel-source-collector.ts test/case-investigation-parallel.test.mjs
git commit -m "feat: collect knowledge and Redmine evidence in parallel"
```

---

### Task 9: 实现同因确定性门禁和案例调查结果构建

**Files:**
- Create: `src/runtime/case-investigation/historical-case-gate.ts`
- Create: `src/runtime/case-investigation/case-investigation-result.ts`
- Modify: `src/runtime/review-presentation.ts`
- Create: `test/historical-case-gate.test.mjs`
- Modify: `test/answer-fidelity-provenance.test.mjs`

**Interfaces:**
- Produces:

```ts
export function validateHistoricalCaseVerification(input: {
  verification: HistoricalCaseVerification;
  evidence: readonly Evidence[];
  coverageEvidenceEnvelopes: readonly CoverageEvidenceEnvelope[];
  sourceStatuses: CaseInvestigationSourceStatuses;
}): {
  verification: HistoricalCaseVerification;
  blockers: ReviewGlobalBlocker[];
};

export function diagnosticResultFromCaseInvestigation(input: {
  answerGoal: AnswerGoal;
  sources: CaseInvestigationSources;
  analysis: HistoricalCaseAnalysis;
  verification: HistoricalCaseVerification;
}): DiagnosticResult;
```

`ReviewPresentationService.reviewAndFormat` context 扩展为：

```ts
context: {
  coverageEvidenceEnvelopes?: CoverageEvidenceEnvelope[];
  upstreamBlockers?: ReviewGlobalBlocker[];
}
```

- [ ] **Step 1: 写双侧证据、反证和来源失败降级的失败测试**

覆盖矩阵：

| 当前 workspace/log | 本轮 Redmine MCP | 冲突 | 允许结果 |
| --- | --- | --- | --- |
| 有 | 有 | 无 | `same_root_cause_likely` |
| 无 | 有 | 无 | `diagnostic_lead_only` |
| 有 | 无 | 无 | `diagnostic_lead_only` |
| 有 | 有 | 有 | `diagnostic_lead_only` |
| 仅 manual/user_claim | 有 | 无 | `diagnostic_lead_only` |
| 有但 envelope 非 current run | 有 | 无 | `diagnostic_lead_only` |
| 有 | Redmine timeout/failed | 无 | `diagnostic_lead_only` |

还要断言降级结果保留有证据的“初步判断”，但不能使用“确认同因”“就是同一个问题”等最终语气。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/historical-case-gate.test.mjs test/answer-fidelity-provenance.test.mjs`

Expected: FAIL，现有 Review 不理解 historical-case blockers。

- [ ] **Step 3: 实现 gate、result builder 和 Review blocker 注入**

同因检查只接受：

```ts
const current = evidence.filter((item) => item.kind === 'workspace' || item.kind === 'log');
const historical = evidence.filter((item) => item.kind === 'mcp' && item.source.startsWith('redmine:issue:'));
```

并要求两侧 evidence ID 都存在于当前 coverage envelopes、freshness 合法、validated=true。失败时将 verifier relation 降级为 `diagnostic_lead_only` 并注入稳定 blocker；`freezeReviewedDiagnosticResult` 继续负责最终 claim 接受/降级。

- [ ] **Step 4: 运行专项测试**

Run: `pnpm build && node --test test/historical-case-gate.test.mjs test/answer-fidelity-provenance.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/runtime/case-investigation/historical-case-gate.ts src/runtime/case-investigation/case-investigation-result.ts src/runtime/review-presentation.ts test/historical-case-gate.test.mjs test/answer-fidelity-provenance.test.mjs
git commit -m "feat: enforce dual-source historical case evidence"
```

---

### Task 10: 编排完整 Case Investigation 回合并接入 Runtime

**Files:**
- Create: `src/runtime/case-investigation/case-investigation-turn-service.ts`
- Modify: `src/runtime/diagnostic-runtime.ts`
- Create: `test/case-investigation-runtime.test.mjs`
- Modify: `test/supper-helper.test.mjs`

**Interfaces:**
- Produces:

```ts
export class CaseInvestigationTurnService {
  tryAnswer(
    caseSession: StoredCase,
    request: DiagnosticRequest,
    replyToMessageId?: string,
  ): Promise<RuntimeTurnResponse | undefined>;
}
```

- [ ] **Step 1: 写 fast path、完整案例路径、Worker 条件启动和单次呈现的失败测试**

覆盖：

- Planner `fast_answer` 返回 `undefined`，旧 Experience → Knowledge → MCP → Worker 顺序不变。
- Planner `case_investigation` 后 Experience/Knowledge 命中也不能早停。
- Knowledge 与 Redmine 完成后才调用 Analyzer。
- Assessor `worker_not_needed` 时 Worker 调用 0 次。
- Assessor `worker_needed` 且计划安全时 Worker 恰好 1 次。
- Worker 有反证时 Verifier 不能输出同因。
- Planner 失败时 Redmine search 恰好 1 次，projectAliases 为 workspace 全部 allowlist。
- 整个案例路径只创建一个用户可见 helper message、只调用一次 Review/Presentation、只调用一次 `completePresentedTurn`。
- `/api/chat` 同步 shape 保持 200 旧结构；`async:true` 保持 202 旧结构。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/case-investigation-runtime.test.mjs test/supper-helper.test.mjs`

Expected: FAIL，`CaseInvestigationTurnService` 尚未接入。

- [ ] **Step 3: 实现专用 turn service 和薄 composition root**

Runtime 顺序固定为：

```ts
const decision = await this.preflight.decide(...);
// ask_user 分支保持原样
const investigation = await this.caseInvestigation.tryAnswer(
  caseSession,
  decision.request,
  replyToMessageId,
);
if (investigation) return investigation;
// 以下保留旧快速路径
```

`CaseInvestigationTurnService.tryAnswer()`：

1. Planner。
2. fast_answer 返回 `undefined`。
3. Experience collect 与 Knowledge/Redmine sources 一起保留，但 Experience 不早停。
4. Analyzer。
5. Assessor。
6. 安全计划需要时构造 ephemeral workerRequest 和 sanitized persistedRequest，调用一次 Worker collect。
7. Verifier。
8. 确定性 gate 和 result builder。
9. 创建/更新一个正式 Run。
10. `reviewAndFormat(..., { coverageEvidenceEnvelopes, upstreamBlockers })`。
11. 一次 `completePresentedTurn`。

`src/runtime/diagnostic-runtime.ts` 必须维持不超过模块边界测试规定的 300 行；将现有通用 MCP 完成逻辑抽成私有 service 或 helper 文件，而不是继续堆入 composition root。

- [ ] **Step 4: 运行 Runtime 专项测试**

Run: `pnpm build && node --test test/case-investigation-runtime.test.mjs test/supper-helper.test.mjs test/turn-presentation-integrity.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/runtime/case-investigation/case-investigation-turn-service.ts src/runtime/diagnostic-runtime.ts test/case-investigation-runtime.test.mjs test/supper-helper.test.mjs
git commit -m "feat: orchestrate model-driven case investigations"
```

---

### Task 11: 增加安全生命周期事件、Dashboard 进度和日志标签

**Files:**
- Create: `src/runtime/event-recorder/case-investigation.ts`
- Modify: `src/runtime/event-recorder/base.ts`
- Modify: `src/runtime/event-recorder/index.ts`
- Modify: `src/runtime/case-investigation/case-investigation-turn-service.ts`
- Modify: `src/runtime/case-investigation/parallel-source-collector.ts`
- Modify: `src/observability/log-blocks.ts`
- Modify: `web/src/dashboard/chat-progress.ts`
- Modify: `web/src/dashboard/chat-progress.test.ts`
- Modify: `test/runtime-hardening.test.mjs`
- Modify: `test/supper-helper.test.mjs`
- Modify: `docs/standards/development.md`

**Interfaces:**
- 新 agent identities：Evidence Source Planner、Historical Case Analyzer、Current Evidence Assessor、Historical Case Verifier。
- 新安全 phases：
  - `evidence_source_plan_started/result/failed`
  - `parallel_source_collection_started/completed`
  - `knowledge_source_completed`
  - `redmine_search_started/completed`
  - `redmine_candidates_selected`
  - `redmine_details_completed`
  - `historical_case_analysis_started/result`
  - `current_evidence_assessment_result`
  - `case_worker_verification_requested`
  - `historical_case_verification_result`

- [ ] **Step 1: 写事件身份、detail 白名单、进度映射和泄漏防护的失败测试**

事件 detail 只允许：

```ts
{
  status?: SourceStatus;
  durationMs?: number;
  candidateCount?: number;
  selectedIssueIds?: number[];
  evidenceIds?: string[];
  sourceStatuses?: Record<string, SourceStatus>;
  workerRequested?: boolean;
}
```

测试递归扫描 `src/runtime/event-recorder/*.ts`，禁止记录 `query`、`signals`、工单 subject/body/journal、人员字段、URL、token、模型 reason、原始 error。UI 测试断言 `resolveProgressStage()` 对新 phases 返回稳定中文标题。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/runtime-hardening.test.mjs test/supper-helper.test.mjs && pnpm test:web -- web/src/dashboard/chat-progress.test.ts`

Expected: FAIL，新 phases 没有标签或进度映射。

- [ ] **Step 3: 实现事件 recorder、日志标签和 UI 映射**

高层阶段必须用 `actor:'agent'` 且带真实 identity；MCP 调用事件继续 `actor:'mcp'`。不要为了让 `recentAgentActivity` 展示而伪造 MCP Agent。

`chat-progress.ts` 至少映射：

```ts
{ test: /evidence_source_plan/, title: '规划证据来源' }
{ test: /parallel_source_collection|knowledge_source|redmine_search|redmine_details/, title: '并行收集知识与历史工单' }
{ test: /historical_case_analysis|redmine_candidates_selected/, title: '分析相似历史案例' }
{ test: /current_evidence_assessment|case_worker_verification/, title: '验证当前环境证据' }
{ test: /historical_case_verification/, title: '核验是否属于同一问题' }
```

- [ ] **Step 4: 运行专项测试**

Run: `pnpm build && node --test test/runtime-hardening.test.mjs test/supper-helper.test.mjs && pnpm test:web -- web/src/dashboard/chat-progress.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/runtime/event-recorder src/runtime/case-investigation src/observability/log-blocks.ts web/src/dashboard/chat-progress.ts web/src/dashboard/chat-progress.test.ts test/runtime-hardening.test.mjs test/supper-helper.test.mjs docs/standards/development.md
git commit -m "feat: surface safe case investigation progress"
```

---

### Task 12: 固化模块边界、架构文档和公共 DTO 不泄漏

**Files:**
- Modify: `docs/standards/module-boundaries.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/agents.md`
- Modify: `src/agents/README.md`
- Modify: `test/module-boundaries.test.mjs`
- Modify: `test/gateway-case-safety.test.mjs`
- Modify: `test/runtime-hardening.test.mjs`
- Create: `docs/runbooks/redmine-mcp.md`
- Create: `scripts/verify-redmine-mcp-real.mjs`
- Modify: `package.json`

**Interfaces:**
- `src/mcp-servers/` 只实现外部 MCP server adapter，不可导入 `runtime/`、`gateway/`、`workers/`、`sessions/`、`knowledge/`。
- `src/runtime/case-investigation/` 可依赖稳定 port/service，不实现 HTTP 或 Redmine REST。
- Gateway DTO 继续序列化现有字段，但禁止出现内部 investigation state。

- [ ] **Step 1: 写模块依赖、序列化和显式真实联调脚本的失败测试**

新增边界断言：

```js
assertNoImportPattern(
  tsFilesUnder(join(srcRoot, 'mcp-servers')),
  [
    /from\s+['"](?:\.\.\/)+runtime(?:\/|['"])/,
    /from\s+['"](?:\.\.\/)+gateway(?:\/|['"])/,
    /from\s+['"](?:\.\.\/)+workers(?:\/|['"])/,
    /from\s+['"](?:\.\.\/)+sessions(?:\/|['"])/,
    /from\s+['"](?:\.\.\/)+knowledge(?:\/|['"])/,
  ],
  'MCP servers must remain standalone external adapters',
);
```

公共 API fixtures 必须断言序列化 JSON 不含：

- `caseInvestigation`
- `verificationPlan`
- `expectedMatch`
- `expectedMismatch`
- Redmine description/journal 原文
- `REDMINE_API_KEY`
- 任意模型内部 reason。

真实联调脚本只在显式 `pnpm acceptance:redmine:real` 运行，并在缺 env 时安全退出非零；默认 `test` 不引用该脚本。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm build && node --test test/module-boundaries.test.mjs test/gateway-case-safety.test.mjs test/runtime-hardening.test.mjs`

Expected: FAIL，文档/模块边界/安全断言尚未建立。

- [ ] **Step 3: 更新文档、边界测试和真实联调 runbook**

`docs/runbooks/redmine-mcp.md` 必须包含：

- 创建专用只读 Redmine 账号与 API Key。
- 配置项目 alias→数值 ID。
- stdio 开发启动示例与 HTTP 生产启动示例。
- HTTP Bearer 与 Redmine API Key 是两层独立凭证。
- curl/MCP smoke 只做 list/search/detail 的读操作。
- 如何确认 backend、超时、分页、缓存、私有备注和日志脱敏。
- 回滚方式：从 workspace 移除 historicalCaseSources 或禁用 MCP server。

真实联调脚本输出只显示 backend、tool names、候选数、详情数、耗时和安全错误码。

- [ ] **Step 4: 运行专项测试和文档 lint**

Run: `pnpm lint && pnpm build && node --test test/module-boundaries.test.mjs test/gateway-case-safety.test.mjs test/runtime-hardening.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add docs/standards/module-boundaries.md docs/architecture/overview.md docs/architecture/agents.md src/agents/README.md test/module-boundaries.test.mjs test/gateway-case-safety.test.mjs test/runtime-hardening.test.mjs docs/runbooks/redmine-mcp.md scripts/verify-redmine-mcp-real.mjs package.json
git commit -m "docs: document Redmine case investigation operations"
```

---

### Task 13: 全量验证、离线验收和变更收尾

**Files:**
- Modify only if a validation exposes a defect in files owned by Tasks 1-12.
- Update: `openspec/changes/add-redmine-case-investigation/tasks.md`

**Interfaces:**
- Consumes: Tasks 1-12 的完整实现。
- Produces: apply-ready OpenSpec task checklist 全部完成、全量质量门通过。

- [ ] **Step 1: 运行格式与文档验证**

Run: `pnpm lint`

Expected: PASS。

- [ ] **Step 2: 运行 TypeScript 与 Vue 类型检查**

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 3: 运行生产构建**

Run: `pnpm build`

Expected: PASS，`dist/cli.js` 与 `dist/mcp-servers/redmine/main.js` 均存在。

- [ ] **Step 4: 运行 Node 全量测试**

Run: `pnpm test`

Expected: PASS。

- [ ] **Step 5: 运行 Dashboard 单元测试**

Run: `pnpm test:web`

Expected: PASS。

- [ ] **Step 6: 运行离线 Redmine 专项验收**

Run: `node --test test/redmine-*.test.mjs test/historical-case-*.test.mjs test/case-investigation-*.test.mjs`

Expected: PASS，无真实网络请求。

- [ ] **Step 7: 检查密钥、原始正文与写操作泄漏**

Run:

```bash
rg -n "REDMINE_API_KEY|X-Redmine-API-Key|redmine_search_issues|redmine_get_issue_case_details|create_issue|update_issue|delete_issue" src test docs package.json
```

Expected:

- `REDMINE_API_KEY` 只出现在配置读取、runbook 和测试。
- `X-Redmine-API-Key` 只出现在 client、runbook 和测试。
- 生产 MCP 只注册两个读工具。
- 生产代码不存在 Redmine create/update/delete 工具。

- [ ] **Step 8: 对照设计逐条完成 OpenSpec task checklist**

Run: `openspec status --change add-redmine-case-investigation`

Expected: 所有 apply artifacts 完整；`tasks.md` 中已实现条目全部勾选。

- [ ] **Step 9: 提交验证收尾**

```bash
git add openspec/changes/add-redmine-case-investigation/tasks.md
git commit -m "test: verify Redmine case investigation"
```

---

## 自审结果

- 设计第 1-5、15-18 节由 Tasks 1、4、10、12 覆盖。
- Planner、模型语义路由与失败兜底由 Task 6 覆盖；不存在关键词触发步骤。
- Knowledge/Redmine 并行、10→3 两次调用与来源独立失败由 Tasks 5、8 覆盖。
- Redmine REST、双 backend、GET-only、API Key、项目 allowlist、隐私、附件和 48K 结构预算由 Tasks 2-4 覆盖。
- 历史案例分析、当前证据判断、可选单次 Worker 和 Verifier 由 Tasks 6、7、10 覆盖。
- 当前+历史双侧门禁、反证降级和 Evidence Review 接入由 Task 9 覆盖。
- 异步 Dashboard 复用、事件身份、日志标签和安全 detail 由 Task 11 覆盖。
- 公共 DTO、持久化、模块边界、真实联调隔离、运维与回滚由 Task 12 覆盖。
- 全量 lint、typecheck、build、Node tests、Vue tests 和专项离线验收由 Task 13 覆盖。
- 所有跨任务接口名称与类型在首次产生的任务中定义，后续任务使用相同名称。
- 计划不要求真实 Redmine 地址或凭证，默认实现和验收可完全离线完成。
