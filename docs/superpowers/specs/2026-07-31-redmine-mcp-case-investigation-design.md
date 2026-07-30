# Redmine MCP 历史案例调查设计

日期：2026-07-31

状态：已完成方案讨论，待用户审阅书面设计

## 1. 背景

`super-helper` 已具备两项相关基础能力：

- `src/mcp/` 支持 stdio、HTTP 和 SSE MCP Client，并提供 workspace allowlist、只读权限、工具白名单、超时、结果归一化和 Evidence Review 接入。
- `src/knowledge/redmine-card.ts` 可以把离线 Redmine issue JSON 转成 `review_required` 知识卡片，但目前只支持 `knowledge redmine import-fixture`，不连接真实 Redmine API。

当前 Runtime 的答案来源顺序是：

```text
Experience → Knowledge → MCP → Worker
```

该流程采用串行早停。Knowledge 一旦可以回答，MCP 就不会执行，因此历史工单无法参与知识结论的交叉验证。通用 MCP 阶段当前也只是按配置顺序执行最多两个工具，不能完成“搜索候选 → 模型重排 → 批量读取详情 → 当前环境验证”的案例调查流程。

本设计将 Redmine 作为实时、只读的历史案例证据来源。Knowledge 与 Redmine 并行采集，模型负责语义路由、案例匹配、同因判断和验证计划；Runtime 负责权限、预算、状态机和 Evidence Review。

## 2. 目标

### 2.1 产品目标

- 模型判断当前问题是否需要查询历史工单，不通过代码关键词列表触发。
- 对需要案例调查的问题，并行查询 Knowledge 与 Redmine。
- 从最多 10 条候选工单中选择最相关的 3 条读取详情。
- 区分相同根因、相同症状但不同根因、仅可借用排查方向和无关案例。
- 判断历史排查方向是否仍适用于当前版本、配置和运行状态。
- 当前证据不足时，由模型决定是否启动只读 Workspace Worker 验证。
- 最终结论继续遵守 `AnswerGoal`、`DiagnosticClaim` 和 Evidence Review 合同。

### 2.2 工程目标

- 同一 Redmine MCP 实现支持开发环境 stdio 和生产环境 HTTP transport。
- Redmine MCP 使用专用只读服务账号和 API Key。
- 默认离线开发和测试，不要求真实 Redmine 地址或凭证。
- 保持现有 HTTP response shape 兼容。
- 对持久化 Case JSON 的任何新增字段采用可选、版本化、向后兼容的策略，不批量重写旧数据。

## 3. 非目标

第一阶段不包含：

- 创建、更新、关闭、评论或删除 Redmine 工单。
- 自动执行历史工单里的写配置、数据修复或其他有副作用操作。
- 下载或解析附件正文。
- 把全部 Redmine 工单批量同步到 Knowledge。
- 用 Redmine MCP 直接生成用户最终回复。
- 仅凭历史工单相似度认定当前问题根因。
- 为 Jira、禅道或其他工单系统同时实现 adapter；设计保留后续扩展边界。

## 4. 已确认的设计决策

| 主题 | 决策 |
| --- | --- |
| 接入形态 | Redmine MCP 是核心接入；Skill 不承担 API 连接 |
| 触发方式 | 模型生成结构化证据来源计划；代码不维护触发关键词 |
| 规划失败 | 默认执行一次受限、只读 Redmine 查询 |
| 项目范围 | workspace 配置多个项目 allowlist；模型从 allowlist 选择，无法判断时查询全部允许项目 |
| 检索深度 | 搜索最多 10 条候选，模型重排后读取最多 3 条详情 |
| 来源关系 | Knowledge 与 Redmine 并行，不再互相早停 |
| 同因门槛 | 必须同时引用当前证据和历史工单证据 |
| Worker | 当前证据不足且需要根因或解决方案时，由模型决定启动只读 Worker |
| 来源失败 | 各来源独立超时；一个失败时使用另一个继续并显式保留证据缺口 |
| 部署 | 开发使用 stdio，生产使用内网 HTTP MCP |
| 认证 | 专用只读 Redmine API Key |
| 隐私 | 私有备注按 workspace 显式开启；人员身份匿名化；附件只返回元数据 |
| 交互 | 普通问答保留同步快速路径，案例调查进入异步进度流程 |

## 5. 总体架构

```text
Preflight / AnswerGoal
          ↓
Evidence Source Planner（模型）
          ↓
   ┌──────┴──────────┐
   ↓                 ↓
Knowledge Retrieval  Redmine Case Retrieval
Hybrid Retrieval     search 10 → rerank → detail 3
   ↓                 ↓
Knowledge Evidence   Historical Case Evidence
   └──────┬──────────┘
          ↓
Evidence Aggregator
          ↓
Historical Case Analyzer（模型）
          ↓
Current Evidence Assessment（模型）
          ↓
当前证据不足？──是──→ Read-only Worker
          │                    ↓
          └──────────← Current Workspace/Log Evidence
                       ↓
Historical Case Verifier（模型）
                       ↓
Evidence Review → Presentation
```

### 5.1 快速路径与案例调查路径

Evidence Source Planner 输出 `mode`：

- `fast_answer`：不需要历史案例调查，保留现有快速路径。
- `case_investigation`：进入并行证据采集，不允许 Experience 或 Knowledge 提前结束本轮。

进入 `case_investigation` 后，Experience 即使命中，也只能作为候选证据加入 Aggregator，不能绕过 Redmine、案例分析和 Review。

## 6. Evidence Source Planner

### 6.1 职责

Planner 基于以下输入做语义判断：

- 当前 `AnswerGoal`
- 当前 Case 的 confirmed facts、user claims、hypotheses 和 unknowns
- workspace 可用证据来源
- workspace 允许的 Redmine project aliases
- MCP 工具 schema

Planner 不接触 API Key、真实 MCP Token 或任意未授权项目。

### 6.2 输出合同

```json
{
  "mode": "case_investigation",
  "reason": "当前问题需要参考历史同类案例并验证当前环境",
  "sources": {
    "knowledge": {
      "enabled": true,
      "query": "课程创建成功但前台不可见的产品规则和配置条件",
      "moduleCandidates": ["edusoho-training"]
    },
    "redmine": {
      "enabled": true,
      "query": "课程创建成功、后台可见、前台不展示",
      "projectAliases": ["training", "common-platform"],
      "signals": ["创建成功", "前台不可见"],
      "candidateLimit": 10,
      "detailLimit": 3
    }
  }
}
```

`query`、`moduleCandidates`、`signals` 和来源选择由模型生成。Runtime 不使用中文问法、错误关键词或意图枚举重新选择来源。

### 6.3 Runtime 确定性约束

Runtime 只负责：

- JSON schema 校验。
- 来源是否已配置。
- project alias 是否属于 workspace allowlist。
- alias 到 Redmine 数值 project ID 的固定映射。
- 最大项目数、候选数、详情数、调用数和超时。
- MCP 是否只读、启用、在 workspace allowlist 且工具名已授权。

### 6.4 规划降级

Planner 超时、失败或返回非法结构时：

- Knowledge 正常检索。
- Redmine 对 workspace 全部允许项目执行一次有界、只读基础查询。
- 记录 `source_plan_status=degraded` 和安全错误原因。
- 降级本身不得提高结论置信度。

## 7. 并行证据采集

### 7.1 执行模型

```ts
Promise.allSettled([
  collectKnowledgeEvidence(plan.sources.knowledge),
  collectRedmineCaseEvidence(plan.sources.redmine),
])
```

每个分支返回统一 `SourceOutcome`：

```json
{
  "source": "redmine",
  "status": "completed",
  "evidenceIds": ["redmine_12345_description"],
  "missingInfo": [],
  "durationMs": 820,
  "truncated": false
}
```

允许的来源状态：

- `completed`
- `no_hit`
- `timeout`
- `failed`
- `not_planned`

`timeout` 和 `failed` 不能转换成 `no_hit`。任何一个来源先返回，都不能提前触发最终回复。

### 7.2 Aggregator

Aggregator 保留来源边界，不把所有文本重新混成一个无来源的向量列表：

```json
{
  "knowledge": {
    "status": "completed",
    "evidenceIds": ["kb_ev_01", "kb_ev_02"]
  },
  "historicalCases": {
    "status": "completed",
    "issueIds": [12345, 12888, 13102],
    "evidenceIds": ["redmine_12345_description"]
  },
  "experience": {
    "status": "no_hit",
    "evidenceIds": []
  },
  "sourceGaps": []
}
```

Knowledge、Redmine、Workspace/Log 和 user claim 必须保持不同 provenance 与 freshness。

## 8. Redmine MCP Server

### 8.1 部署

开发环境：

```text
super-helper → stdio Redmine MCP → fixture/fake Redmine
                                   ↘ 可选真实测试环境
```

生产环境：

```text
super-helper → HTTP MCP（Redmine 内网）→ Redmine REST API
```

同一个 MCP Server 实现两种 transport，工具合同完全一致。

### 8.2 认证

生产环境存在两层独立认证：

```text
super-helper
  │ MCP Bearer Token / 内网身份
  ↓
Redmine MCP
  │ X-Redmine-API-Key
  ↓
Redmine REST API
```

要求：

- Redmine 开启 REST API。
- 使用专用只读服务账号，不使用管理员账号。
- API Key 只通过 `X-Redmine-API-Key` 请求头发送，不放入 URL。
- 不使用 `X-Redmine-Switch-User`。
- MCP Token 与 Redmine API Key 使用不同 `SecretRef`。
- 工具输入不能传入 `baseUrl`、任意请求头或任意 URL。
- `baseUrl` 在 MCP Server 启动时固定，并要求生产环境使用 TLS 或受控内网链路。

### 8.3 工具一：`redmine_search_issues`

输入：

```json
{
  "query": "课程创建成功但前台不可见",
  "projectAliases": ["training", "common-platform"],
  "signals": ["创建成功", "前台不可见"],
  "filters": {
    "status": ["open", "closed"],
    "updatedAfter": null
  },
  "limit": 10
}
```

约束：

- `projectAliases` 必须属于 workspace allowlist。
- MCP adapter 只使用配置中固定的 alias → 数值 project ID 映射。
- `limit` 最大为 10。
- 搜索必须覆盖 open 和 closed issue。
- 搜索结果只是候选，不得输出根因或面向用户的结论。

Redmine 的 Search API 与稳定 Issues API 能力不同，adapter 必须提供两个确定的 backend，并在启动 smoke test 中选定，不在每个请求中临时猜测：

- `rest_search`：实例支持 `/search.json` 时，使用 `q`、`issues=1` 和有界分页搜索。Search API 返回后，adapter 必须解析 issue ID，再通过受控 issue 查询验证每条候选所属的数值 project ID；workspace allowlist 外的结果不得进入 MCP 输出。
- `issues_scan`：Search API 不可用时，按允许的数值 `project_id` 调用稳定的 `/issues.json`，显式设置 `status_id=*`、`sort=updated_on:desc`、分页上限和配置化历史窗口，再在 MCP Server 内对 subject、description 和允许的 custom fields 做有界词法召回。

`issues_scan` 的词法召回只消费模型生成的 `query` 和 `signals`，用于候选检索，不参与“是否触发 Redmine”或“是否同因”的判断。默认每个项目最多读取 5 页、每页 100 条，结果可以使用 5 分钟的进程内缓存；缓存必须记录 `fetchedAt`，并受 Redmine 搜索总超时约束。实际页数、历史窗口和缓存 TTL 全部配置化。

由于 Redmine `/issues.json` 默认只返回 open issue，`issues_scan` 必须显式设置 `status_id=*`。`rest_search` 也必须关闭仅 open issue 的过滤，或在实例不支持该行为时降级到 `issues_scan`。

返回：

```json
{
  "candidates": [
    {
      "issueId": 12345,
      "projectAlias": "training",
      "subject": "课程发布后前台不显示",
      "descriptionExcerpt": "……",
      "status": "已解决",
      "tracker": "缺陷",
      "priority": "普通",
      "fixedVersion": "23.4",
      "createdOn": "2026-01-10T08:00:00Z",
      "updatedOn": "2026-01-12T10:30:00Z",
      "sourceLocator": "redmine:issue:12345"
    }
  ],
  "truncated": false
}
```

### 8.4 候选模型重排

模型根据当前问题比较：

- 症状
- 产品模块
- 触发条件
- 产品版本
- 错误码或日志信号
- 租户配置
- 工单是否有明确处理记录

模型从最多 10 条候选中选择最多 3 条。此阶段只选择案例，不确认当前根因。

### 8.5 工具二：`redmine_get_issue_case_details`

输入：

```json
{
  "issueIds": [12345, 12888, 13102],
  "include": [
    "description",
    "custom_fields",
    "journals",
    "status_transitions",
    "relations",
    "attachment_metadata"
  ]
}
```

约束：

- 最多 3 个 issue ID。
- issue 必须来自当前 Run 第一次搜索的候选集合，并属于允许项目。
- 第二次 MCP 调用内部可以并行读取最多 3 个详情。
- 对 Redmine 的映射请求为 `GET /issues/{id}.json?include=journals,relations,attachments`。
- 不下载附件正文。

返回：

```json
{
  "cases": [
    {
      "issueId": 12345,
      "sourceLocator": "redmine:issue:12345",
      "updatedOn": "2026-01-12T10:30:00Z",
      "facts": {
        "subject": "课程发布后前台不显示",
        "projectAlias": "training",
        "status": "已解决",
        "fixedVersion": "23.4",
        "customFields": []
      },
      "evidenceBlocks": [
        {
          "evidenceId": "redmine_12345_description",
          "kind": "description",
          "text": "……"
        },
        {
          "evidenceId": "redmine_12345_journal_18",
          "kind": "journal",
          "createdOn": "2026-01-11T09:20:00Z",
          "text": "确认由发布范围配置导致……"
        },
        {
          "evidenceId": "redmine_12345_resolution",
          "kind": "resolution",
          "text": "调整发布范围后恢复正常……"
        }
      ],
      "truncation": {
        "omittedJournalCount": 0,
        "omittedAttachmentCount": 0,
        "truncatedFields": []
      }
    }
  ]
}
```

MCP Server 不返回：

- `same_root_cause`
- 当前问题诊断结论
- 面向用户的回答
- 没有绑定原始工单字段的语义总结

## 9. 历史案例分析

### 9.1 Historical Case Analyzer

输入：

- `AnswerGoal`
- 当前会话 confirmed facts、user claims 和 unknowns
- Knowledge evidence
- 最相关的 3 条 Redmine 工单详情

职责：

- 提取有 evidence ID 绑定的历史根因、解决动作和排除项。
- 比较当前描述与历史症状、模块、版本、配置条件和错误信号。
- 检查历史处理方式是否与 Knowledge 产品规则冲突。
- 生成候选假设和只读验证计划。
- 不得直接确认当前问题同因。

输出：

```json
{
  "caseAssessments": [
    {
      "issueId": 12345,
      "relation": "possible_same_root_cause",
      "matchedFacts": [
        {
          "text": "都表现为课程已创建但前台不可见",
          "currentEvidenceIds": ["user_claim_02"],
          "historicalEvidenceIds": ["redmine_12345_description"]
        }
      ],
      "conflicts": [
        {
          "text": "历史工单发生在 23.4，当前版本尚未确认",
          "historicalEvidenceIds": ["redmine_12345_fixed_version"]
        }
      ],
      "historicalCause": {
        "text": "历史工单由发布范围配置导致",
        "evidenceIds": ["redmine_12345_journal_18"]
      },
      "historicalResolution": {
        "text": "调整发布范围后恢复",
        "evidenceIds": ["redmine_12345_resolution"]
      },
      "remainingUnknowns": [
        "当前课程发布范围",
        "当前产品版本"
      ]
    }
  ],
  "verificationPlan": [
    {
      "checkId": "check_publish_scope",
      "purpose": "验证当前问题是否具备历史根因的关键条件",
      "action": "只读检查课程发布范围配置",
      "expectedMatch": "发布范围未包含当前访问站点",
      "expectedMismatch": "发布范围已经包含当前访问站点",
      "historicalEvidenceIds": ["redmine_12345_journal_18"],
      "safety": "read_only"
    }
  ]
}
```

`user_claim` 只证明用户报告过该现象，不能作为当前系统已验证事实。

### 9.2 历史排查步骤状态

Analyzer 对每个历史排查步骤标记：

- `applicable`：当前条件与历史前提一致，可以执行只读验证。
- `needs_verification`：可能有用，但缺少版本、配置或状态条件。
- `contradicted`：与当前证据或 Knowledge 产品规则冲突。
- `unsafe`：涉及写配置、数据修复或副作用，不能自动执行。

这些状态由模型根据语义和证据判断。Runtime 不维护关键词列表或硬编码相似度权重。

## 10. 当前证据验证

### 10.1 Current Evidence Assessment

模型判断当前证据是否足以回答 `AnswerGoal`：

```json
{
  "currentEvidenceSufficient": false,
  "workerRequired": true,
  "reason": "需要验证当前发布范围是否与历史根因条件一致",
  "verificationCheckIds": ["check_publish_scope"]
}
```

代码不根据用户问法或错误关键词决定是否启动 Worker。

### 10.2 Read-only Worker

Worker 接收中性验证合同，而不是“证明历史工单正确”的指令：

```json
{
  "hypothesis": "当前问题可能与发布范围配置有关",
  "supportingHistoricalEvidenceIds": ["redmine_12345_journal_18"],
  "checks": [
    {
      "checkId": "check_publish_scope",
      "expectedMatch": "发布范围未包含当前访问站点",
      "expectedMismatch": "发布范围已经包含当前访问站点",
      "permission": "read_only"
    }
  ]
}
```

Worker 必须同时寻找支持证据和反证，只返回当前 Workspace、日志或配置 evidence。Worker 不作最终同因判断，也不执行写操作。

### 10.3 Historical Case Verifier

Verifier 比较：

- Knowledge 产品规则证据
- Redmine 历史案例证据
- 当前 Workspace/Log 证据
- Analyzer 候选假设和冲突

允许的最终分类：

- `same_root_cause_likely`
- `same_symptom_different_cause`
- `diagnostic_lead_only`
- `irrelevant`

`same_root_cause_likely` 输出示例：

```json
{
  "classification": "same_root_cause_likely",
  "reason": "当前发布范围配置与历史工单根因特征一致，并符合产品规则",
  "currentEvidenceIds": ["workspace_publish_scope_01"],
  "historicalEvidenceIds": [
    "redmine_12345_journal_18",
    "redmine_12345_resolution"
  ],
  "knowledgeEvidenceIds": ["kb_course_visibility_rule"],
  "conflicts": [],
  "remainingUnknowns": []
}
```

## 11. Evidence Review 门禁

- `same_root_cause_likely` 必须引用至少一个当前 evidence 和一个历史 evidence。
- 产品行为、配置规则或版本适用性结论应引用 Knowledge evidence。
- Knowledge 不可用时，只能表达为有当前验证支持的经验性判断，并明确规则证据缺口。
- Redmine `timeout/failed` 时不得声称“没有类似历史工单”。
- Knowledge `timeout/failed` 时不得把历史案例提升成正式产品规则。
- 只有 user claim 而没有当前验证 evidence 时，最高只能输出 `diagnostic_lead_only`。
- 关键条件冲突时必须输出 `same_symptom_different_cause` 或降级。
- 历史解决动作涉及写操作时，只能作为需用户授权的建议，不允许 Worker 自动执行。
- Presentation 只能表达 Review 冻结的 primary answer claim IDs，不得根据相似工单自行新增结论。

## 12. 超时、调用和负载预算

所有默认值必须配置化：

| 阶段 | 默认限制 |
| --- | ---: |
| Source Planner | 8 秒 |
| Knowledge 分支 | 10 秒 |
| Redmine 搜索 | 8 秒 |
| 候选模型重排 | 8 秒 |
| Redmine 详情 | 10 秒 |
| Redmine 分支总预算 | 28 秒 |
| 并行采集总屏障 | 30 秒 |
| 候选工单 | 10 条 |
| 详情工单 | 3 条 |
| Redmine MCP 调用 | 2 次 |

Worker 使用现有配置的独立超时。案例调查采用异步进度，不让长 Worker 阻塞同步 HTTP 请求。

### 12.1 结构化截断

当前通用 MCP normalizer 会按字符切割结构化 JSON。Redmine 案例必须改用 schema-aware bounding：

- 在 JSON 序列化前按完整 evidence block 截断。
- 不截断半条 journal 或半个 JSON 对象。
- 保留 issue ID、evidence ID、时间、kind 和来源定位。
- 优先保留基础字段、description、状态变化、关闭前后 journal 和显式 relation。
- 超出预算时丢弃完整低优先级 block。
- 返回 `omittedJournalCount`、`omittedAttachmentCount` 和 `truncatedFields`。
- 三条详情的结构化总预算默认 48,000 字符。

通用 `normalizeMcpResult` 的既有 20,000 字符行为不直接放宽。通用 MCP Client 增加显式注册的 schema-aware structured-result 路径：只有配置为 `historical_case` capability 且通过 Redmine Case Envelope schema 校验的结果，才允许使用 48,000 字符预算。该路径在序列化前按完整 block 收缩并再次校验；普通 MCP 仍使用既有 20,000 字符上限。禁止先生成 48,000 字符 JSON 再用字符串切片截到 20,000 字符。

## 13. 安全与隐私

### 13.1 权限

- Redmine 服务账号只拥有允许项目的读取权限。
- MCP 只暴露两个查询工具。
- MCP Server 对 Redmine 只允许预定义 GET endpoint。
- 禁止 POST、PUT、PATCH、DELETE。
- issue 详情只能读取当前 Run 搜索结果中的 issue ID。
- 工具参数不能修改 hostname、scheme、port、请求头或认证方式。

### 13.2 数据最小化

- 默认 `includePrivateNotes=false`。
- workspace 显式配置后才能读取私有备注。
- 人员姓名、登录名和邮箱映射为稳定匿名 ID。
- 第一阶段不下载附件内容。
- 模型只接收完成判断所需的有界字段。
- MCP Server 即使从 Redmine 收到更多字段，也必须执行二次 allowlist 过滤。

### 13.3 日志脱敏

日志可以记录：

- server ID
- project alias
- issue ID
- tool name
- 状态
- 耗时
- 候选数量
- evidence ID
- 截断计数

日志不得记录：

- API Key
- MCP Token
- Authorization header
- 工单正文或 journal 正文
- 人员身份
- 原始 Redmine payload
- 未脱敏错误响应

## 14. 异步交互与可观测性

普通问答保留同步快速路径。`case_investigation` 使用异步 Runtime pipeline，前端展示：

```text
正在规划证据来源
正在并行查询产品知识和历史工单
找到 10 条候选工单，正在读取 3 条详情
正在比较历史案例
正在验证当前环境
正在交叉审核证据
```

新增内部事件建议：

- `evidence_source_plan_started`
- `evidence_source_plan_result`
- `evidence_source_plan_failed`
- `parallel_source_collection_started`
- `knowledge_source_completed`
- `redmine_search_started`
- `redmine_search_completed`
- `redmine_candidates_selected`
- `redmine_details_completed`
- `parallel_source_collection_completed`
- `historical_case_analysis_started`
- `historical_case_analysis_result`
- `current_evidence_assessment_result`
- `case_worker_verification_requested`
- `case_worker_verification_completed`
- `historical_case_verification_result`

事件 detail 只保存安全摘要和 evidence ID。`src/observability/` 只负责转换和展示，不参与状态机决策。

## 15. 模块边界

### 15.1 新增 MCP Server 边界

```text
src/mcp/
  通用 MCP Client、权限、allowlist、transport 和结果归一化

src/mcp-servers/redmine/
  contracts/
  redmine-api/
    client
    authentication
    protocol
    error-mapping
  tools/
    search-issues
    get-issue-case-details
  transports/
    stdio
    http
  main
```

`src/mcp-servers/redmine/` 是独立进程边界，负责 Redmine REST 协议、字段归一化、MCP 工具合同和 transport，不负责：

- Runtime 编排
- AnswerGoal
- 案例相似度或同因判断
- Evidence Review
- 用户最终回复

实施前必须更新 `docs/standards/development.md`、`docs/standards/module-boundaries.md` 和 `docs/architecture/overview.md`，正式声明该 ownership。

当前 npm 包可以增加第二个可执行入口：

```text
super-helper-redmine-mcp
```

不要求第一阶段把仓库转换为 pnpm workspace。

### 15.2 Runtime

```text
src/runtime/case-investigation/
  evidence-source-planner-service.ts
  parallel-source-collector.ts
  historical-case-analyzer-service.ts
  current-evidence-assessor-service.ts
  historical-case-verifier-service.ts
```

Runtime 负责模型阶段编排、来源状态、调用预算、Worker 决策和 Review 接入，不实现 Redmine HTTP 协议。

### 15.3 Product Agents

```text
src/agents/
  evidence-source-planner.md
  historical-case-analyzer.md
  current-evidence-assessor.md
  historical-case-verifier.md
```

全部登记到 `src/agents/registry.json`，并声明 `mayProduceUserFacingText=false`。Presentation 仍是唯一表达冻结结果的 Agent。

### 15.4 Gateway、Worker 和 Observability

- Gateway 只启动或继续同一 Runtime turn，并序列化现有 DTO。
- Worker 只执行结构化只读验证计划，不查询 Redmine，不作最终同因判断。
- Observability 只展示新阶段，不决定是否查询或是否升级。

## 16. 配置

概念配置：

```yaml
mcpTools:
  - id: company-redmine
    name: Company Redmine
    protocol: http
    permission: read_only
    enabled: true
    allowedToolNames:
      - redmine_search_issues
      - redmine_get_issue_case_details
    config:
      url: https://redmine-mcp.example.internal/mcp
      headers:
        Authorization:
          source: file
          key: mcp.company-redmine

workspaces:
  - id: edusoho-training
    mcpToolIds:
      - company-redmine
    historicalCaseSources:
      - serverId: company-redmine
        type: redmine
        allowedProjects:
          - alias: training
            redmineProjectId: 12
          - alias: common-platform
            redmineProjectId: 27
        includePrivateNotes: false
        candidateLimit: 10
        detailLimit: 3
```

Redmine MCP Server 自身配置：

```yaml
redmine:
  baseUrl: https://redmine.example.internal
  searchBackend: auto
  apiKey:
    source: env
    name: REDMINE_API_KEY
  requestTimeoutMs: 10000
  search:
    maxPagesPerProject: 5
    pageSize: 100
    historyLookbackDays: 1095
    cacheTtlMs: 300000
```

示例地址和 SecretRef 名称只用于文档，不包含真实环境信息。

`searchBackend=auto` 只允许在启动或显式 smoke test 中解析为 `rest_search` 或 `issues_scan`，运行期查询必须使用已经冻结的 backend。能力探测结果只记录 backend 和安全状态，不记录响应正文。

## 17. 持久化与兼容策略

该功能不得改变现有 public API response shape。

案例调查需要结构化的临时状态。优先使用 turn 内部的 `CaseInvestigationState`，只把最终 evidence、claims 和安全事件写入现有 Run/Event 结构。若 Worker 合同必须通过 `DiagnosticRequest.context` 接收验证计划，则：

- 新增字段必须是可选的 `context.caseInvestigation`。
- 字段包含 `schemaVersion: 1`。
- 旧 Case 缺少字段时按未启用案例调查处理。
- 不批量改写旧 Case JSON。
- public DTO 默认不暴露内部验证计划和模型理由。
- 必须增加旧 fixtures 读取、新 fixtures round-trip 和 public DTO 兼容测试。
- 实施前通过 OpenSpec 明确记录这一可选持久化 shape 变更和迁移策略。

已有 `context.knowledge` 与 `context.mcp` 继续保存各自有界证据，不复制原始 Redmine payload。

## 18. 错误处理

| 情况 | 行为 |
| --- | --- |
| Planner 超时或非法输出 | 启用一次 Redmine 兜底查询，标记 degraded |
| Knowledge no hit | Redmine 与 Worker 可继续 |
| Knowledge timeout/failed | 不把历史案例表达为正式产品规则 |
| Redmine no hit | 可以明确“本次允许范围内未检索到相似工单” |
| Redmine timeout/failed | 不允许表达“没有相似工单” |
| Search API 不可用 | 启动 smoke test 时冻结为 `issues_scan`；运行期不反复探测 |
| 候选重排失败 | 使用搜索结果的稳定顺序选择最多 3 条，标记 degraded |
| 某条详情 404/403 | 保留其他案例，并记录该 issue 的安全失败状态 |
| Redmine 401 | 返回认证不可用的安全错误，不记录响应正文 |
| Redmine 429 | 遵守有界退避或直接降级，不阻塞超过来源总预算 |
| MCP payload 截断 | 保留完整 blocks 与 truncation metadata，降低覆盖判断 |
| Analyzer schema 非法 | 不启动带该计划的 Worker，降级为来源证据不足 |
| Worker 找到反证 | Verifier 不得输出同因 |
| Review 无法覆盖 mustAnswerItems | 输出初步判断、unknown 或追问，不输出最终结论 |

## 19. 测试策略

### 19.1 Redmine API adapter 单元测试

- API Key 只进入 `X-Redmine-API-Key`。
- 只允许固定 base URL 和 GET。
- 拒绝未授权 project alias、project ID 和 issue ID。
- 显式使用 `status_id=*` 覆盖 closed issue。
- `rest_search` 结果必须经过数值 project ID allowlist 复核。
- Search API 不可用时稳定降级到有界 `issues_scan`。
- `issues_scan` 的分页、历史窗口、缓存 TTL 和总超时均有上限。
- 分页、custom fields、relations、journals 和附件元数据归一化。
- 私有备注默认过滤，开启后仍执行身份匿名化。
- 401、403、404、429、5xx、timeout 和无效 JSON 安全归一化。
- schema-aware truncation 保持 JSON 和 evidence block 完整。

### 19.2 MCP 合同测试

- stdio 与 HTTP transport 暴露相同工具 schema。
- 搜索最多返回 10 条。
- 详情最多接受 3 个来自当前候选集合的 issue ID。
- 工具不能返回 final answer 或 `same_root_cause`。
- secrets 和原始错误不进入结果、日志和快照。

### 19.3 Runtime 测试

- Knowledge 与 Redmine 确实并行。
- 任一来源先完成都不能提前回答。
- Planner 成功、失败、超时和 schema 非法路径。
- Planner 失败时只执行一次有界 Redmine 兜底。
- `timeout/failed` 不会被转换成 `no_hit`。
- Experience 在案例调查路径不能提前返回。
- 当前证据不足时按模型决策启动 Worker。
- Worker 同时检查支持条件和反证条件。
- 没有当前 evidence 时不能输出 `same_root_cause_likely`。
- 有版本或配置冲突时输出 `same_symptom_different_cause` 或降级。
- Review 继续覆盖 `AnswerGoal.mustAnswerItems`。

### 19.4 Agent fixtures

至少覆盖：

- 同症状、同根因。
- 同症状、不同根因。
- 只有排查方向可复用。
- 历史版本与当前版本冲突。
- 历史解决步骤与 Knowledge 产品规则冲突。
- 工单无明确解决记录。
- 无关工单。
- Redmine 来源超时。
- 历史步骤包含写操作。
- 用户只提供未经验证的现象。

### 19.5 兼容测试

- 读取没有 `caseInvestigation` 的旧 Case fixtures。
- 新 Case round-trip。
- `/api/chat`、`/api/session`、`/api/sessions` 和 `/api/logs` response shape 不变。
- 同步快速路径行为不变。
- 异步路径继续使用同一 Runtime pipeline。

### 19.6 最低验证

实现阶段至少运行：

```text
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

真实 Redmine smoke test 必须是显式命令，默认测试不联网、不花钱、不需要真实凭证。

## 20. 分阶段落地

### 阶段一：合同与离线 MCP

- 建立 OpenSpec change。
- 更新模块边界文档。
- 定义 Redmine MCP 工具 schema、fake Redmine API 和脱敏 fixtures。
- 实现 stdio transport、只读 API adapter 和合同测试。

### 阶段二：HTTP MCP 与配置

- 增加 HTTP transport 和 MCP 服务认证。
- 增加 workspace project allowlist、SecretRef 和 smoke test。
- 保持默认离线。

### 阶段三：并行案例调查 Runtime

- 增加 Evidence Source Planner 和来源并行采集。
- 取消案例调查路径的 Knowledge/MCP 早停。
- 增加候选重排、Analyzer、Current Evidence Assessment 和 Verifier。
- 接入 Worker、Review 和审计事件。

### 阶段四：UI 与真实环境联调

- 展示异步案例调查进度。
- 使用专用测试项目和只读服务账号验证。
- 验证项目权限、私有备注策略、超时、429 和脱敏。
- 真实地址和凭证只通过部署配置注入。

## 21. 验收标准

- 模型可以在没有关键词硬编码的情况下选择 `case_investigation`。
- Planner 失败时有一次受限 Redmine 兜底查询。
- 模型不能选择 workspace allowlist 外的项目。
- Knowledge 与 Redmine 并行执行，并保留独立来源状态。
- Redmine 搜索最多 10 条，详情最多 3 条，总 MCP 调用最多 2 次。
- Redmine MCP 只执行只读 GET，不生成用户回复或同因结论。
- 历史案例结论全部绑定 Redmine evidence ID。
- `same_root_cause_likely` 同时绑定当前和历史 evidence。
- 历史排查方向与 Knowledge 或当前证据冲突时不会被直接采用。
- 当前证据不足时，模型可以生成中性只读验证计划并启动 Worker。
- Worker 反证可以阻止同因结论。
- 任一来源失败时系统继续可用，并准确表达证据缺口。
- 私有备注、人员身份、附件、凭证和原始响应符合本设计的数据最小化规则。
- 旧 Case、既有 API response shape 和非案例调查快速路径保持兼容。

## 22. 官方接口依据

- Redmine REST API 认证与通用约定：<https://www.redmine.org/projects/redmine/wiki/REST_Api>
- Redmine Issues API：<https://www.redmine.org/projects/redmine/wiki/rest_issues>
- Redmine Search API：<https://www.redmine.org/projects/redmine/wiki/Rest_Search>
- Redmine Issue Journals API：<https://www.redmine.org/projects/redmine/wiki/Rest_IssueJournals>

官方文档确认：

- API Key 可以通过 `X-Redmine-API-Key` 请求头发送。
- `/issues.json` 默认只返回 open issue，需要显式设置 `status_id=*` 才能同时覆盖 open 和 closed。
- issue 列表的 `project_id` 是数值 ID。
- `/search.json` 支持 `q`、分页和 issue scope，但属于 Alpha 能力，因此需要稳定 Issues API fallback。
- issue 详情可以通过 `include=journals,relations,attachments` 获取关联数据。
- journals 包含 notes 与字段变化，可用于还原处理时间线。
