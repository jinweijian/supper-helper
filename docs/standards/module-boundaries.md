# super helper Module Boundary Standards

本文是 `super helper` 的全仓模块化开发硬规范。

它约束后续所有 AI coding agent、人工开发者、重构和 OpenSpec change：任何新功能、修复、重构都必须先判断所属层级，再写实现。不能为了快，把厂商协议、业务策略、HTTP DTO、CLI 输出、runtime 决策塞进同一个文件或同一个模块。

本文件回答三个问题：

- 代码应该放在哪一层。
- 哪些内容绝对不能放在该层。
- 一个文件或流程变复杂时必须怎么拆。

## 总原则

代码必须按责任和契约组织，而不是按“当前改起来方便”组织。

每次改动开始前，必须先回答：

- 这个能力属于哪个模块或层级？
- 它消费的 public contract 是什么？
- 它暴露的 public contract 是什么？
- 哪些模块明确不能 import 它？
- 它是否改变 HTTP response、config、case JSON、knowledge artifact 或 CLI 行为？
- 它的默认测试是否不联网、不花钱、不依赖真实凭证？

如果无法回答，先补设计文档或 OpenSpec design，不要直接写代码。

## 分层原则

默认层级如下。新模块必须能归入其中一类；归不进去时，先更新架构文档。

| Layer | Owns | Must Not Own |
| --- | --- | --- |
| `domain/contracts` | 稳定类型、端口、跨模块契约、纯领域概念 | 厂商 API 协议、HTTP DTO、文件路径策略、CLI 输出、runtime 编排 |
| `config/secrets` | 配置加载、默认值、配置合并、SecretRef materialize、持久化脱敏 | provider 调用、worker 调用、runtime 决策、HTTP route 行为 |
| `settings` | 设置页/设置 API 的配置合并、SecretRef 应用、public settings 映射、model/embedding/rerank smoke test 编排 | HTTP request/response、provider 厂商协议、runtime 诊断决策 |
| `gateway` | HTTP、路由、DTO、请求响应序列化、状态码 | Preflight、worker dispatch、检索策略、provider 协议、证据审核、最终回复 |
| `cli` | `main.ts` 分发、`command-*` 参数解释、命令组合、用户可读输出、进程退出码 | provider adapter、RAG/recall 策略、runtime 诊断决策、knowledge 索引内部算法、HTTP route |
| `runtime` | 用户回合编排、Agent 决策、Preflight、Evidence Review、降级/升级路径、生命周期事件 | HTTP DTO、厂商协议、原始文件持久化细节、knowledge 索引实现、CLI 输出 |
| `knowledge` | 本地知识文件、schema、Markdown/frontmatter、source metadata、本地 keyword index、本地 vector artifact build/read/compatibility、本地 evidence pack | 远程 provider API 调用、runtime 编排、最终回答、Claude Code 执行、HTTP route 决策、retrieval ranking/rerank 策略 |
| `providers` | embedding/rerank provider contracts、factory、远程 provider adapters、smoke tests、安全错误归一化 | knowledge 目录结构、检索策略、runtime 决策、HTTP DTO、CLI 输出、最终回复 |
| `retrieval` | 跨 `knowledge` + `providers` 的多策略召回、query embedding、候选融合、rerank、fallback、retrieval trace | 用户最终回复、Evidence Review、HTTP DTO、provider 厂商协议实现、knowledge artifact 写入 |
| `sessions` | case repository port、case context、会话上下文构建、session storage scope | worker/model 调用、最终回复、HTTP DTO、provider 调用 |
| `workers` | worker port、具体 worker adapter、CLI/tool 执行、worker 输出解析 | case 编排、用户回复、HTTP route、Evidence Review |
| `observability` | 日志展示结构、log block 转换、UI 可观测性数据 | 诊断流程决策、worker 执行、provider 调用 |
| `ui` | 浏览器 UI 渲染、客户端交互、展示状态 | server route、runtime 决策、worker 行为、provider 协议 |

新增 BM25、embedding、业务规则召回、hybrid recall、candidate fusion、query embedding 编排、rerank 编排时，必须放在 `src/retrieval/` 对应层级，不能继续塞进 `knowledge` 或 `providers`。

## 适配器模式硬规则

任何外部厂商、模型服务、工具服务都必须按适配器模式接入。

Provider 能力统一放在 `src/providers/`。Embedding 与 rerank 是同级能力，目录必须体现这种关系：

```text
src/providers/
  errors.ts
  redaction.ts
  http.ts
  embedding/
    contract.ts
    factory.ts
    smoke-test.ts
    fake.ts
    siliconflow/
      adapter.ts
      endpoint.ts
      protocol.ts
  rerank/
    contract.ts
    factory.ts
    smoke-test.ts
    fake.ts
    siliconflow/
      adapter.ts
      endpoint.ts
      protocol.ts
```

每类 provider 至少拆成以下责任：

- `types` / `contract`：只定义端口、输入输出、健康检查结果和稳定错误类型。
- `factory`：只做 provider 选择、基础配置校验、返回端口实现。
- `<capability>/<vendor>`：只实现该厂商协议、request body、response mapping、状态码映射、超时和网络错误转换。
- `errors` / `redaction`：统一安全错误、脱敏、retryable 分类。
- `smoke-test`：只通过端口验证连通性，不暴露原始向量、原始文档、secret、完整 provider payload。

禁止：

- 把 SiliconFlow、Qwen、MiniMax、Gemini 等多个厂商实现混在 factory 文件。
- 把 rerank 当作 embedding provider 的附属实现；rerank 和 embedding 必须是同级 provider 能力。
- 让 provider adapter import `knowledge`、`runtime`、`gateway`、`cli`、`ui`。
- 在 provider adapter 内读取 file SecretRef。SecretRef 必须在 `config/secrets` 或 onboarding/config 边界 materialize 成运行时配置。
- 在 provider adapter 内决定检索策略、证据排序、是否能直接回答用户。
- 在 smoke test 返回值中包含原始向量、完整文本、Authorization header、cookie、API key 或 provider 原始错误 payload。

## 文件拆分规则

出现以下任一情况，必须拆文件或先写重构计划：

- 一个文件同时包含 contract、factory、adapter、CLI 输出、业务策略中的两类以上。
- 一个文件新增后超过约 300 行，或已有大文件继续增加新职责。
- 一个函数同时做“读取输入 + 决策 + 外部调用 + 输出格式化”。
- 新功能无法用一句话说明所属模块。
- 需要在文件顶部 import 三个以上不同层级的模块才能完成新逻辑。
- 测试只能通过 mock 内部函数而不能在模块边界验证行为。

拆分顺序固定：

1. 先提 contract / port，稳定调用方和被调用方的边界。
2. 再提纯函数或本地领域逻辑，让无副作用规则可单测。
3. 再提 adapter，把外部协议和副作用隔离。
4. 最后保留入口 facade，只做 re-export 或窄组合调用；不得新增私有兼容 facade。

拆分时不得顺手改变 public API、config shape、case JSON shape、knowledge artifact shape。确需改变时，必须有 OpenSpec、迁移策略和兼容测试。

根目录历史入口迁移时，只有 OpenSpec 明确列出兼容消费者和删除窗口，才允许保留 deprecation re-export。该 re-export 必须只转发到新 owner 模块，不得继续承载私有组合逻辑、默认值、业务策略或命令输出。内部新代码必须从新 owner 路径导入，旧路径只服务公开兼容过渡，并且需要对应 import 兼容测试和后续删除任务。

## 控制流边界

一个用户请求的控制流必须保持单向、可审计：

```text
gateway/cli
  -> runtime 或所属 command service
  -> domain ports
  -> adapters / local repositories
  -> structured result
  -> runtime review / presenter
  -> gateway/cli serialization
```

禁止反向依赖：

- adapter 调 runtime。
- knowledge 调 gateway。
- provider 调 knowledge。
- worker 直接写用户最终回复。
- CLI 子命令复制 runtime 决策。
- route handler 直接调用 worker 或模型。

## 数据和配置边界

配置、secret、持久化数据必须有明确边界。

规则：

- `config` 负责默认值、加载、合并、持久化脱敏。
- `secrets` 负责 SecretRef 存取和 materialize。
- runtime 和 provider 只能拿到运行时需要的最小配置。
- public DTO 只能暴露 `hasApiKey`、env 名称等安全信息，不能暴露 file secret key 对应的明文。
- provider error 必须经过 safe error normalization 和 redaction。
- knowledge artifact 必须可从源知识重建，不能混入 runtime 临时判断或用户最终回复。

禁止：

- 把明文 API key 写入 `config.json`、fixture、日志、错误信息。
- 在 provider adapter 中读取本地 secrets 文件。
- 在 gateway DTO 中拼接 provider 请求体。
- 在 runtime 中手写知识文件路径策略。
- 在 knowledge 索引 artifact 中保存不需要的完整敏感原文。

## CLI 规则

CLI 是用户入口，不是业务模块。

CLI 可以：

- 解释参数。
- 调用所属 command service。
- 打印用户可读输出。
- 设置退出码。
- 组合 server/dashboard/status/doctor 等本地入口。

CLI 不可以：

- 实现 provider 协议。
- 实现 RAG、rerank、candidate fusion 策略。
- 直接写 runtime 诊断决策。
- 复制 gateway route 的 DTO 逻辑。
- 在一个大入口文件中持续堆新子命令。

CLI 目录使用 `command-*` 前缀，方便目录列表中聚合命令适配器：

```text
src/cli/
  main.ts
  command-server.ts
  command-status.ts
  command-doctor.ts
  command-knowledge.ts
  command-retrieval.ts
  command-provider.ts
  command-config.ts
  command-accept.ts
```

新增复杂子命令时，必须放到 `src/cli/command-<name>.ts` 或所属业务模块的 service 中，入口文件只保留分发。根入口 `src/cli.ts` 只能是 shebang 执行包装。

## Knowledge / Retrieval / Providers 边界

这三层最容易混淆，必须严格区分：

- `knowledge` 只管本地知识资产和本地 evidence pack。
- `providers` 只管 embedding/rerank provider 端口和厂商调用。
- `retrieval` 负责编排 BM25、embedding、未来业务策略等 recall，candidate merge、rerank 和 fallback。
- `runtime` 负责决定 retrieval 结果是否进入 Evidence Judge、是否直接回答、是否升级到 Claude Code。

具体要求：

- `knowledge` 可以读取 `vectors.jsonl`、`vector-manifest.json`，但不能自己调用远程 embedding 或 rerank provider。
- `knowledge/indexes/` 可以维护 chunks、keyword、BM25、vector 等可重建 artifact；artifact 读写不等于召回策略所有权。
- `retrieval/recall/bm25/` 与 `retrieval/recall/embedding/` 必须是同级策略。BM25 是召回策略，不应藏在 embedding 或 knowledge indexer 里。
- `providers` 可以返回向量或 rerank scores，但不能知道 chunk、document、case、persona、Evidence Judge。
- `retrieval` 可以依赖 `knowledge` 的本地 search/read API 和 `providers` 的 provider port，但不能生成用户可见最终回复。
- `runtime` 可以创建或注入 retrieval service，但不得直接实现厂商 request/response mapping。

多路召回的目录应表达扩展点：

```text
src/retrieval/
  service.ts
  registry.ts
  recall/
    contract.ts
    bm25/
    embedding/
    keyword/
  fusion/
  rerank/
  evidence-pack.ts
  trace.ts
```

新增或删除召回策略时，优先新增/删除 `retrieval/recall/<strategy>/` 并调整 registry，不要在 runtime 或 CLI 中增加策略分支。

## OpenSpec 和 PR 验收清单

每个 feature/refactor 的 OpenSpec、PR 描述或实现说明必须回答：

- 这个能力属于哪个模块或层级？
- 为什么不能放在相邻模块？
- 消费和暴露的 public contract 是什么？
- 哪些模块明确不能 import 它？
- 是否新增外部 provider、命令、HTTP API、config、artifact 或持久化 shape？
- 失败、空数据、缺凭证、超时、限流、脏缓存、旧 artifact 如何处理？
- 默认测试是否不联网、不花钱、不依赖真实凭证？
- 是否需要 fake/fixture acceptance 和 real opt-in acceptance？
- 是否需要更新 `docs/standards/development.md`、`docs/architecture/overview.md` 或 OpenSpec artifacts？

没有完成这份清单的实现，不能视为架构完成。

## Anti-Patterns

以下模式必须阻止或在 review 中退回：

- 一个入口文件一路写完整流程。
- route handler 变成 mini runtime。
- CLI 文件变成业务流程文件。
- factory 文件包含具体厂商协议细节。
- provider adapter 依赖 knowledge schema。
- knowledge indexer 调远程 provider。
- runtime 解析 HTTP DTO 或拼接 provider request body。
- worker 或 MCP 工具直接生成用户最终回复。
- smoke test 默认联网或默认消耗真实额度。
- 错误信息、日志、fixture 泄漏 secret、原始向量或完整用户文本。

## 当前债务处理方式

如果现有代码已经违反本规范，不要求在无关 feature 中顺手大改。

处理规则：

- 新代码不得继续加深违规。
- 涉及违规文件时，优先把新增逻辑放到正确层。
- 如果必须碰违规路径，OpenSpec 或 PR 必须说明过渡方案。
- 架构性债务应单独创建 change，保护 public API、config、case JSON 和 knowledge artifact 兼容。

当前已知需要后续单独创建 OpenSpec 的方向：

- 为新增召回策略补充 registry 级别的 enable/disable 配置和观测字段。
- 为 provider / retrieval / knowledge / settings / CLI 边界持续增加 contract tests，防止回退。

这些是后续修复 spec 的输入，不是本规范文档本身要实施的代码改动。
