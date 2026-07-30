## Why

当前 Runtime 采用 Experience → Knowledge → MCP → Worker 的串行早停流程：Knowledge 一旦可回答，历史工单不会参与交叉验证；通用 MCP 也无法完成“搜索候选、模型重排、读取详情、验证当前环境”的案例调查。我们需要把 Redmine 接成受限的只读历史证据源，并让模型在不依赖硬编码关键词的前提下决定何时调查历史案例。

## What Changes

- 新增独立的 Redmine MCP Server，提供搜索工单与批量读取候选详情两个 GET-only 工具，同时支持开发环境 stdio 和生产环境 Streamable HTTP。
- 新增 workspace 历史案例来源配置、项目 allowlist、专用 read-only capability 和 schema-aware 结构化 MCP 结果边界。
- 新增模型驱动的 Evidence Source Planner；模型选择快速路径或案例调查路径，Planner 失败时只执行一次有界只读 Redmine 兜底查询。
- 案例调查路径并行采集 Knowledge 与 Redmine，搜索最多 10 条、模型选择最多 3 条，再读取详情。
- 新增 Historical Case Analyzer、Current Evidence Assessor 和 Historical Case Verifier；当前证据不足时可派发一次结构化只读 Worker 验证。
- 新增确定性同因门禁：只有同时存在当前 workspace/log 证据和本轮 Redmine MCP 证据，且无关键冲突时，才允许表达“可能相同根因”。
- 案例调查过程中 Experience 与 Knowledge 只提供候选证据，不能提前结束回合；普通快速路径保持现有行为。
- 新增安全阶段事件和 Dashboard 进度映射；事件与公共 DTO 不持久化或暴露 Redmine 原始正文、人员身份、模型内部理由、验证计划或凭证。
- 默认测试完全离线；真实 Redmine 联调仅通过显式验收脚本运行。

## Capabilities

### New Capabilities

- `redmine-read-only-mcp`: Redmine REST 只读适配、两个 MCP 工具、双 transport、候选授权、项目范围、隐私归一化和结构化预算。
- `historical-case-investigation`: 模型来源规划、Knowledge/Redmine 并行采证、10→3 案例选择、历史分析、当前验证、可选 Worker、同因门禁和兼容降级。

### Modified Capabilities

- `diagnostic-agent-runtime`: Preflight 后增加专用案例调查分支，并保持 Worker、Review、Presentation 和 Gateway 的既有职责边界。
- `multi-agent-configuration`: 增加四个不可直接回复用户的案例调查 Agent 配置、registry 配对和可观测身份。
- `layered-knowledge-diagnosis`: Knowledge 在案例调查路径只返回证据，不因可回答而提前完成回合；普通知识快速路径不变。
- `validated-experience-reuse`: Experience 在案例调查路径只作为候选历史证据，不能绕过 Redmine、当前证据验证和 Review。
- `runtime-observability-hygiene`: 增加案例调查阶段事件，同时收紧 event detail、日志和公共 DTO 的敏感数据边界。

## Impact

- 新增 `src/mcp-servers/redmine/` 独立进程和 `super-helper-redmine-mcp` package bin。
- 扩展 `src/mcp/` 的 historical-case capability、结构化归一化和专用证据 service。
- 扩展 workspace/MCP 配置，但新增字段均可选，旧配置和旧 Case JSON 无需迁移。
- 新增 `src/runtime/case-investigation/` 专用编排模块，并小幅重构 Knowledge、Experience 和 Worker 以暴露无提前呈现的采证接口。
- 新增四个 `src/agents/` 配置与 registry 条目。
- Gateway 路由和 API 顶层 response shape 不变；Dashboard 复用现有 async 轮询，仅增加进度标签。
- 不新增外部依赖；继续使用现有 MCP SDK、Zod、Node `fetch` 和测试框架。
