## Context

当前系统已有两条独立能力链路：

- Agent 模型链路：`src/model.ts` 通过 `models.providers` 调用 OpenAI-compatible chat/completions，用于 preflight / review 等模型辅助判断。
- 知识库链路：`src/knowledge/` 负责 Markdown/frontmatter/source metadata、keyword chunks 和本地 evidence pack search。

embedding 不应复用 Agent 模型链路。最新实施范围改为优先使用 SiliconFlow embedding API，Gemini/千问/Qwen 暂无接入渠道，MiniMax 当前不支持用户需要的 embedding/rerank 路径，因此不在本轮实装。如果把 embedding API 写死到 `src/knowledge/indexer.ts` 或复用 `src/model.ts`，会产生几个问题：

- 文档向量和查询向量可能来自不同 provider/model/dimensions，导致检索结果不可解释。
- 换 provider 后旧向量容易被误用。
- secret、batch、timeout、错误格式和 usage 统计会散落在知识库代码里。
- 后续接 Gemini/千问时会改动核心索引逻辑。

本设计新增 `src/embedding/`，作为 embedding provider adapter 层。它只负责把文本转成向量、归一化 provider 错误、返回 metadata，不负责最终检索排序、Evidence Judge、用户回复或 HTTP 路由。

## Goals / Non-Goals

**Goals:**

- 新增统一 `EmbeddingProvider` 接口，支持 document embedding、query embedding、batch 和 provider metadata。
- 第一轮实现 SiliconFlow embedding provider 和配置入口，支持后台配置 model/baseUrl/endpoint/apiKeyEnv/dimensions/distance/batch/timeout。
- Gemini、千问/Qwen、MiniMax 不在本轮真实 provider 范围内；README 只说明如何按同一接口扩展。
- SiliconFlow rerank API 提供显式 smoke 检测入口，用来验证配置和模型正确性；本 change 不把 reranker 接入 runtime 检索排序。
- 将 Agent model provider 与 embedding provider 配置分离。
- 为向量索引定义 metadata 和一致性检查，确保同一索引内文档向量与查询向量使用同一 provider/model/dimensions/distance。
- 提供 CLI smoke test 和本地 fake provider 测试，避免普通测试产生付费网络调用。

**Non-Goals:**

- 不实现 BM25、hybrid/RRF、reranker、GraphRAG。
- 不引入外部向量数据库。
- 不要求本 change 完成向量检索排序替代现有 keyword search。
- 不让 embedding provider 调用 product Agent prompt。
- 不让 embedding provider 生成最终用户答案。
- 不把 provider secret 写入日志、报告或 knowledge artifact。

## Provider Documentation Baseline

Access date for this design audit: 2026-06-14.

真实 provider adapter 的 request/response shape 不得依赖模型记忆、第三方 SDK 文档或历史博客。实现者必须以 provider 官方文档为准，并在 `implementation-notes.md` 重新记录访问日期和核对结果。

| Provider | Official documentation baseline | Implementation constraint |
| --- | --- | --- |
| SiliconFlow | SiliconFlow official embedding API `https://api-docs.siliconflow.cn/docs/api/embeddings-post` and rerank API `https://api-docs.siliconflow.cn/docs/api/rerank-post` were checked on 2026-06-14. Embeddings use `POST https://api.siliconflow.cn/v1/embeddings`, `Authorization: Bearer <token>`, request fields `model`, `input`, optional `encoding_format`, optional `dimensions` for Qwen/Qwen3 series, and response path `data[].embedding` with usage under `usage`. Rerank uses `POST https://api.siliconflow.cn/v1/rerank`. | Implement real SiliconFlow embedding adapter with fake fetch tests and one sanitized local smoke test. Add rerank smoke detection for model/config correctness. Keep model/dimensions configurable. Do not implement rerank retrieval sorting in this change; document the extension path. |
| MiniMax | MiniMax official docs index `https://platform.minimaxi.com/docs/llms.txt`、API overview `https://platform.minimaxi.com/docs/api-reference/api-overview`、rate limits `https://platform.minimaxi.com/docs/guides/rate-limits`、error codes `https://platform.minimaxi.com/docs/api-reference/errorcode` were checked during spec hardening. The current docs index does not expose an embedding-specific API page or embedding OpenAPI spec. | Do not infer `embo-01`, `/embeddings`, dimensions, auth, response vector path, or batch limits from Spring AI, LangChain, old code, or memory. Unless the implementer finds current official MiniMax embedding docs or the user supplies them, MiniMax real network calls must remain unsupported/scaffolded and covered by fake/scaffold tests only. |
| Gemini | Google Gemini docs are not re-verified for this implementation because the user explicitly excluded Gemini real integration from this round. | Do not implement Gemini real network calls. README may describe how to add a future adapter. |
| Qwen / Alibaba Cloud Model Studio | Alibaba Cloud Model Studio docs are not re-verified for this implementation because the user explicitly excluded Qwen real integration from this round. SiliconFlow may serve Qwen-named models behind the SiliconFlow provider. | Do not implement direct Qwen/DashScope real network calls. README may describe how to add a future adapter. |

Documentation freshness rule:

- If any official provider docs differ from this baseline, update this OpenSpec before coding provider-specific behavior.
- If official docs are unavailable, provider-specific network code must stop. Implement only shared interfaces, fake provider behavior, scaffold errors, and tests that prove the block is safe.
- Third-party references may be recorded as clues, but they cannot satisfy the docs gate.

## Decisions

### 1. 新增 `src/embedding/`，不复用 `src/model.ts`

Decision:

- 新增模块：

```text
src/embedding/
  types.ts
  errors.ts
  provider.ts
  minimax.ts
  gemini.ts
  siliconflow.ts
  qwen.ts (optional unsupported scaffold)
  fake.ts
  metadata.ts
  index.ts
```

- `src/model.ts` 继续只处理 chat/completions。
- `src/embedding/` 只暴露 provider interface、factory、metadata helpers、错误类型和 fake provider。

Rationale:

- chat model 和 embedding model 的输入、输出、batch、维度、usage 和错误都不同。
- 分离后可以允许 Agent 用 MiniMax-M3，同时 embedding 用 MiniMax/Gemini/千问。
- 后续接向量索引时，`src/knowledge/` 只依赖 embedding public surface，不关心厂商 API 细节。

Alternatives considered:

- 复用 `ModelProviderConfig` 和 `createModelClient`。拒绝：会混淆 completion 与 embedding 的接口，也容易把 `/chat/completions` 路径写错。
- 把 provider 直接写到 `src/knowledge/indexer.ts`。拒绝：会让知识库索引和厂商 API 强耦合。

### 2. Embedding 配置独立于 Agent 模型配置

Decision:

- 在 `SuperHelperConfig` 中新增 `embedding` 节点。
- 默认 `enabled: false`，避免 `knowledge:init` 或测试无意调用远程 API。
- SiliconFlow setup template:

```jsonc
{
  "embedding": {
    "enabled": false,
    "provider": "siliconflow",
    "model": "Qwen/Qwen3-Embedding-0.6B",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKeyEnv": "SILICONFLOW_API_KEY",
    "dimensions": 1024,
    "distance": "cosine",
    "batchSize": 16,
    "timeoutMs": 60000
  }
}
```

The command may override `model`, `baseUrl`, `endpoint`, `apiKeyEnv`, and `dimensions` for local smoke or vector build. Enabling embedding must remain explicit.

Rationale:

- provider/model/dimensions 是向量索引兼容性的一部分，不能从 Agent 模型配置推断。
- 默认关闭可以保护本地测试和用户成本。

Alternatives considered:

- 复用 `models.providers` 增加 `kind: embedding`。暂不采用：当前 `models.providers` 已是 Agent 模型配置，混入后会增加 settings UI 和 runtime 选择复杂度。

### 3. Provider interface 使用 query/document 分离

Decision:

接口应表达 document embedding 和 query embedding 的差异：

```ts
export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;

  embedDocuments(input: EmbeddingDocumentInput[], options?: EmbeddingRequestOptions): Promise<EmbeddingBatchResult>;
  embedQuery(input: EmbeddingQueryInput, options?: EmbeddingRequestOptions): Promise<EmbeddingVectorResult>;
}
```

输入/输出必须包含：

- stable input id
- text
- optional content hash
- vector
- dimensions
- provider
- model
- usage
- raw response summary without secrets

Rationale:

- 有些 provider 支持 query/document task type 或不同 input type。接口先分开，后续不会破坏调用方。
- batch result 统一后，knowledge vector builder 可以做 retry、partial failure 和 usage 统计。

Alternatives considered:

- 只提供 `embed(texts: string[])`。拒绝：后续 query/document 优化会破坏接口。

### 4. 向量 metadata 是强契约

Decision:

每条向量记录必须包含：

```ts
{
  vector_id: string;
  source: string;
  document_id: string;
  chunk_id: string;
  text_hash: string;
  provider: 'siliconflow' | 'minimax' | 'gemini' | 'qwen' | 'fake';
  model: string;
  dimensions: number;
  distance: 'cosine' | 'dot' | 'euclidean';
  vector: number[];
  created_at: string;
}
```

索引 manifest 还必须记录：

```ts
{
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  source_chunk_manifest_hash: string;
  vector_count: number;
  generated_at: string;
}
```

Rationale:

- 同一向量空间内混用 provider/model/dimensions 会产生不可解释结果。
- 换模型后必须能检测旧向量并要求重建。

Alternatives considered:

- 只在全局配置里记录 provider/model。拒绝：配置会变，历史向量需要自描述。

### 5. 一致性检查先于查询

Decision:

- 查询 embedding 前必须读取 vector manifest。
- 如果 manifest provider/model/dimensions/distance 与当前配置不一致，系统不得使用旧向量。
- 处理策略：
  - CLI build：提示需要重建并可覆盖。
  - search/runtime：降级到 keyword search，并记录 vector index mismatch。
  - acceptance：将 mismatch 记为失败或 warning，取决于命令模式。

Rationale:

- 错误地混用向量比没有向量更危险，会制造看似高分但不可解释的召回。

### 6. 远程调用必须可测试、可限流、可脱敏

Decision:

- provider 使用 native `fetch` 和 `AbortController`，不新增依赖，除非后续 provider SDK 明确必要。
- 所有 provider adapter 支持 timeout、batch size 和 bounded retry。
- 错误统一为 `EmbeddingProviderError`，包含 provider、status、retryable、safeMessage，不包含 secret。
- 普通单测只用 fake provider 或 fake fetch，不访问网络。
- 真实 provider smoke test 必须由显式 CLI 命令触发。

Rationale:

- 当前项目无运行时 HTTP 客户端依赖，Node >= 20 已有 fetch。
- 测试稳定性和成本优先。

### 7. Knowledge 集成先做 vector artifact，不替代 keyword search

Decision:

- 第一阶段只新增 vector artifact 生成和 metadata 校验。
- 建议路径：

```text
knowledge/indexes/vectors.jsonl
knowledge/indexes/vector-manifest.json
```

- `knowledge update` 默认不调用远程 embedding；新增显式命令或 flag，例如：

```bash
super-helper knowledge vector build --workspace <path>
super-helper embedding test --provider siliconflow --model Qwen/Qwen3-Embedding-0.6B --dimensions 1024
super-helper rerank test --provider siliconflow --model BAAI/bge-reranker-v2-m3
```

- 后续 hybrid retrieval change 再决定如何把 vector scores 融合到 evidence pack。

Rationale:

- 当前用户仍在研究多路召回，embedding adapter 不应该提前定义 hybrid 检索策略。
- 先把 provider 和 vector artifact 做稳，后续检索改造风险更低。

### 8. 执行护栏和完成闸门是本设计的一部分

Decision:

- 本 change 不能只按 checklist 勾选完成。实现者必须按下面的执行流留下证据：

```text
官方文档核对
  -> 写失败测试 RED
  -> 实现最小代码 GREEN
  -> fake provider / fake fetch 验证
  -> vector fixture build 验证
  -> 安全/隐私/diff 审计
  -> fresh verification
  -> implementation-notes 记录证据
```

- 如果执行环境有 Superpowers skills，必须在相关阶段使用：
  - `test-driven-development`: provider adapter、metadata helper、vector builder、CLI dispatch、redaction、compatibility 行为必须先写失败测试。
  - `systematic-debugging`: provider 文档不一致、维度不一致、timeout、rate limit、malformed response、vector artifact mismatch 等问题必须先定位根因，不能猜修。
  - `verification-before-completion`: 标记任务完成前必须重新跑本 change 要求的验证命令，并读取输出。
- 如果执行环境没有这些 skills，必须执行等价纪律，并在 implementation notes 中记录对应证据。
- MiniMax/Gemini 的真实 request/response shape 不能凭模型记忆实现。实现者必须记录官方文档 URL、访问日期、确认的 endpoint/auth/request/response/dimensions/batch 限制。如果无法访问官方文档，必须停下 provider-specific coding，改为 scaffold/fake contract，并更新 OpenSpec。
- Qwen 在本 change 默认只允许 scaffold；任何真实 Qwen 网络调用都需要用户显式扩 scope。
- 默认命令和默认测试不得触发远程 embedding API。真实 smoke test 必须是显式 opt-in。

Completion gates:

- **Gate A: Provider docs gate** - MiniMax/Gemini adapter 编码前，implementation notes 必须列出官方文档核对结果；否则只能提交 unsupported/scaffold。
- **Gate B: Adapter contract gate** - 每个 provider 必须有 fake fetch 或 fake provider tests 覆盖 success、missing credentials、timeout/provider error、malformed response、dimension mismatch。
- **Gate C: Vector artifact gate** - `vectors.jsonl`、`vector-manifest.json`、build report 必须由 fake provider fixture 构建并验证 provider/model/dimensions/distance/text hash。
- **Gate D: Privacy gate** - CLI、errors、reports、manifest、logs 必须证明不包含 API key、headers、cookies、raw chunk text、raw vector values。
- **Gate E: Compatibility gate** - provider/model/dimensions/distance 任一变化必须让旧 vector index 被拒绝或标记 rebuild-required。
- **Gate F: No-network default gate** - `pnpm test`、`knowledge update`、普通启动命令必须证明不会调用真实 MiniMax/Gemini/Qwen。
- **Gate G: Diff boundary gate** - provider 网络逻辑只能在 `src/embedding/`；vector artifact 逻辑只能在 `src/knowledge/`；CLI 只能解析和委托；runtime/gateway/agents 不得混入 embedding 业务决策。

Anti-fake-complete rules:

- 文件存在不等于完成；必须有测试证明 public API 行为。
- mock/fake happy path 通过不等于 provider 完成；必须覆盖错误、维度、batch、redaction 和 malformed response。
- provider smoke 命令存在不等于真实验收完成；必须记录是否实际执行、使用哪个 provider/model/dimensions、输出是否脱敏。
- vector records 写出来不等于可用；必须证明 manifest compatibility 和 text hash stale 检测。
- task checkbox 勾选不等于完成；必须有 implementation notes 和 fresh verification transcript。
- MiniMax provider 文件存在不等于 MiniMax adapter 完成；在官方 MiniMax embedding docs 不可得时，完成标准是“安全 scaffold + 明确 docs-required/unsupported 行为 + fake/scaffold 测试”，不是猜一个 endpoint 跑通。
- Gemini adapter 文件存在不等于 Gemini adapter 完成；必须证明实现与当前 Google Gemini API docs 的 endpoint、auth、task/document-query 行为、response path 和 dimensions 行为一致。

Rationale:

- embedding adapter 的失败模式经常不是编译错误，而是“看似能跑、真实语义错”：用错 endpoint、混用 provider、维度不一致、旧向量误用、无意付费调用、泄露原文或 secret。
- 把执行纪律写入设计，可以减少不同模型/执行者只做表面实现的概率。

## Mandatory Implementation Checkpoints

本 change 必须按阶段交付和记录证据。实现者不得先把所有文件写完再统一补测试，也不得在没有失败测试的情况下勾选实现任务。

Required sequence:

```text
1. Planning gate
   -> 读取本 change 全部 artifact 和项目边界文档
   -> 记录 openspec apply instructions
   -> 记录 provider 官方文档核对状态

2. Provider contract gate
   -> 先写 provider/config/error/fake/scaffold RED tests
   -> 再实现 src/embedding/*
   -> GREEN 后更新 implementation-notes

3. Vector artifact gate
   -> 先写 chunks fixture -> vector artifact RED tests
   -> 再实现 src/knowledge/vector-* 和 path/type exports
   -> GREEN 后记录 artifact 路径、counts、privacy 检查

4. CLI/smoke gate
   -> 先写 CLI dispatch/output RED tests
   -> 再接 src/cli.ts 到 provider/vector helpers
   -> GREEN 后记录 disabled/fake smoke 输出

5. Docs/boundary gate
   -> 更新 docs/standards/development.md 和 docs/architecture/overview.md
   -> 明确 src/embedding/ 与 src/knowledge/ 的新边界
   -> 不能留下“src/knowledge/ 不拥有任何 vector artifact”的旧表述

6. Completion gate
   -> 执行 Anti-Fake-Complete Audit
   -> 更新 implementation-notes
   -> fresh verification 后才能标记完成
```

Stop conditions:

- 如果 MiniMax 官方 embedding docs 仍不可得，必须停下 MiniMax real HTTP coding；只允许 scaffold/docs-required 行为。
- 如果 Gemini 官方 docs 与本设计不同，必须先更新 OpenSpec，再实现 provider-specific request/response 逻辑。
- 如果任一阶段测试只能证明 mock 行为，必须补一个 fixture path 证明真实模块边界贯通。
- 如果发现文档模块边界和实现需求冲突，必须先更新 docs 和本 change，不允许让实现者自行解释。

## End-to-End Fake Acceptance Spine

本 change 的最小可验收贯通链路不是“provider class 能实例化”，而是以下 fake 可重复路径：

```text
SuperHelperConfig.embedding
  -> createEmbeddingProvider(fake config)
  -> FakeEmbeddingProvider.embedDocuments(...)
  -> buildKnowledgeVectorIndex(...)
  -> knowledge/indexes/vectors.jsonl
  -> knowledge/indexes/vector-manifest.json
  -> knowledge/indexes/vector-build-report.json
  -> checkKnowledgeVectorCompatibility(...)
```

This spine must use a small fixture knowledge workspace with `knowledge/indexes/chunks.jsonl`. The fixture must include:

- at least one eligible active chunk
- at least one restricted chunk that must be skipped before text reaches the provider
- stable chunk ids, document ids, source path, text hash/content hash, and source metadata

Acceptance evidence must prove:

- vector builder received only eligible text
- vector records contain provider/model/dimensions/distance/text hash/source ids
- manifest compatibility passes for matching config
- manifest compatibility returns rebuild-required for provider/model/dimensions/distance changes
- build report contains ids, hashes, counts, paths, and safe errors only
- no raw chunk text, raw API key, raw request header, cookie, bearer token, or raw provider payload is persisted in reports or implementation notes

## Risks / Trade-offs

- [Risk] MiniMax/Gemini API endpoint 或响应格式变化。 -> Mitigation: 任务要求编码前核对官方文档；adapter 测试用 fake HTTP 固定 contract，真实 smoke test 独立运行。
- [Risk] 维度配置错误导致索引不可用。 -> Mitigation: provider 返回维度必须与配置校验，不一致即失败。
- [Risk] embedding 远程调用泄露敏感知识文本。 -> Mitigation: 默认 disabled；文档要求 restricted 文档策略；日志禁止输出原文和 secret。
- [Risk] 向量索引体积变大。 -> Mitigation: vectors.jsonl 为派生文件，可删除重建；第一阶段不引入外部 DB。
- [Risk] provider adapter 抽象过度。 -> Mitigation: 只定义 query/document/batch/metadata/error 最小接口，不做复杂插件系统。
- [Risk] 普通测试触发付费调用。 -> Mitigation: 单测只使用 fake provider；真实调用必须显式 CLI flag。
- [Risk] 执行者只按文件/接口清单勾选，遗漏真实边界行为。 -> Mitigation: 本 change 增加 red/green、provider docs、fake smoke、vector fixture、privacy、diff boundary 和 implementation-notes 完成闸门。

## Migration Plan

Phase 1: 配置和类型

- 新增 `embedding` 配置结构，默认 disabled。
- 新增 `src/embedding/types.ts`、`errors.ts`、`provider.ts`、`fake.ts`。
- 不影响现有 `models.providers` 和 Agent 模型选择。

Phase 2: Provider adapters

- 实现 SiliconFlow provider module 和 fake fetch tests。
- 旧 MiniMax/Gemini/Qwen provider 不作为本轮验收；如保留文件，必须保持 unsupported/docs-required 行为，避免误以为已可用。

Phase 3: Vector metadata artifacts

- 新增 vector manifest 和 vector JSONL 类型。
- 从现有 `chunks.jsonl` 构造 embedding inputs。
- 实现 vector build 命令，默认显式执行。

Phase 4: Consistency and CLI

- 实现 vector index compatibility check。
- 实现 `embedding test` 或 `knowledge vector build` CLI。
- 增加 redaction、timeout、batch、error tests。

Phase 5: Documentation and acceptance

- 文档说明 MiniMax/Gemini/Qwen 配置、换模型重建、restricted 文档策略、真实 smoke test。
- 本机 acceptance 记录 provider、model、dimensions、vector count，不保存 secret 或完整原文。

Rollback strategy:

- `embedding.enabled` 设为 false 后系统应回到 keyword-only search。
- 删除 `knowledge/indexes/vectors.jsonl` 和 `vector-manifest.json` 后可从 chunks 重建。
- Agent model 配置不受 embedding 配置影响。

## Open Questions

- restricted 文档是否允许发送到远程 embedding API，需要后续产品策略明确；第一版至少要支持跳过 restricted 文档。
- SiliconFlow rerank API 是否接入 hybrid/rerank runtime，需要后续 retrieval change 明确输入粒度、隐私策略、成本和 Evidence Judge score contract。
