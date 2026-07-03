# super helper

`super helper` 是一个以聊天为入口的本地诊断助手。它围绕任意项目工作区、可配置 MCP 工具和企业知识库，帮助用户整理问题、检索证据、调用只读诊断工具，并输出经过证据审核的结论。

产品里刻意拆开了两类职责：

- `super helper Agent` 负责与用户对话、判断信息是否足够、必要时追问、审核证据、解释结论。
- Claude Code 是被 Agent 调用的诊断工具。在当前最小可用版里，Claude Code 不直接面向用户回复。

## 快速开始

在仓库根目录执行：

```bash
pnpm install
pnpm onboard
```

如果你用 npm：

```bash
npm install
npm run onDashboard
```

`pnpm onboard` 和 `npm run onDashboard` 都会构建项目并启动 Setup Dashboard。打开页面后，一次完成：

- 项目工作区配置
- 知识库根目录与原始知识文件目录配置
- Agent 模型配置
- Embedding 模型配置
- Rerank 模型配置
- 知识库导入、提取、标准化、切片、审计、发布、索引和健康检查

如果需要发布到可信内网：

```bash
pnpm onboard -- --bind lan
npm run onDashboard -- --bind lan
```

LAN 模式会绑定 `0.0.0.0`，方便同一内网访问。当前 MVP 暂未实现访问令牌，请只在可信内网使用。

日常启动已经完成配置的项目：

```bash
pnpm dashboard
npm run dashboard
```

查看本地状态和诊断本地配置：

```bash
pnpm status
pnpm doctor
npm run status
npm run doctor
```

## 本地落盘位置

默认配置文件位于：

```text
~/.super-helper/config.json
```

本地密钥不会写入 `config.json`，会通过 `SecretRef` 引用：

```text
~/.super-helper/secrets.json
```

Onboarding 草稿、运行记录和可恢复进度位于：

```text
~/.super-helper/onboarding/
```

知识库默认位于配置的 `knowledge.rootDir` 下，并按 workspace key 隔离。Setup Dashboard 中填写的知识库根目录会成为实际落盘根目录。典型结构如下：

```text
<knowledge-root>/
  knowledge/
    _sources/
    _taxonomy/
    faq/
    runbooks/
    tickets/
    whitepapers/
    glossary/
    modules/
    indexes/
```

`knowledge/_sources/` 保存原始源文件；`faq/`、`runbooks/`、`whitepapers/`、`modules/`、`glossary/`、`tickets/` 是可维护的结构化 Markdown 知识；`knowledge/indexes/` 保存可重建的关键词索引、向量索引和构建报告。

## 检索流程

运行时知识检索使用多路召回流程：

```text
中文字段加权 BM25 Top 40 + Embedding 向量召回 Top 40
  -> RRF(k=60) 融合并保留 Top 20
  -> 可选 Rerank 输出 Top 8
  -> child 命中按 canonical parent 去重并展开 bounded answer span
  -> canonical parent 补齐质量、来源区块、章节、时效与答案片段
  -> Evidence Judge 严格判断是否足够回答
  -> 不足时升级到 Claude Code 只读诊断
```

召回编排位于 `src/retrieval/`。Embedding 和 Rerank 是同级 provider 能力，分别位于 `src/providers/embedding/` 和 `src/providers/rerank/`；当前真实 provider 是 SiliconFlow，同时保留 fake provider 便于测试。

中文 BM25 使用业务词、中文 bigram 和 Latin token，不再用普通单字制造假命中，并按标题、章节、related terms、module/intent、正文进行 4/3/3/2/1 字段加权。知识索引使用 `parent-child-v2`：300–800 字 child 负责召回，Markdown parent 继续作为最终证据；旧 chunk 可读但不能伪装成直答合格证据。

知识直答采用 fail-closed 门禁：只有 active、fresh、质量为 `ok|info`、来源/区块/章节溯源完整且有明确答案片段的证据才可能直答。Rerank 已运行时要求 top score 至少 `0.70`；未运行时只允许完整标题和至少两个非泛化多字符词的精确词法回退。缺失元数据不会用默认值伪装为安全证据。

## 高级 CLI

Setup Dashboard 是默认流程；下面命令保留给维护、排障和 CI 使用。

知识库维护：

```bash
pnpm knowledge:init -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:update -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:extract -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:normalize -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:slice -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:audit -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:review -- --workspace /path/to/project --knowledge-root /path/to/knowledge --source-id <source-id> --action approve --reviewer <name>
pnpm knowledge:publish -- --workspace /path/to/project --knowledge-root /path/to/knowledge --quality-gate warn
node dist/cli.js knowledge migration-report --workspace /path/to/project --knowledge-root /path/to/knowledge
```

使用 npm 时，把 `pnpm <script>` 换成 `npm run <script>` 即可，例如：

```bash
npm run knowledge:init -- --workspace /path/to/project --knowledge-root /path/to/knowledge
```

从命令行检索：

```bash
pnpm build
node dist/cli.js retrieval search \
  --workspace /path/to/project \
  --knowledge-root /path/to/knowledge \
  --query "这里写你的问题"

node dist/cli.js retrieval debug \
  --workspace /path/to/project \
  --knowledge-root /path/to/knowledge \
  --query "这里写你的问题"

node dist/cli.js retrieval eval \
  --workspace /path/to/project \
  --knowledge-root /path/to/knowledge \
  --questions /path/to/runtime-eval.json \
  --report /path/to/retrieval-eval-report.json
```

`retrieval eval` 走与运行时相同的 Router、configured retrieval 和 Evidence Judge，报告 Recall@5、MRR、直答精度、拒答和必须升级准确率。默认配置关闭 Embedding/Rerank，不会产生网络或付费调用；真实 SiliconFlow 只在显式启用并提供仓库外密钥时运行。

模型连通性检查：

```bash
node dist/cli.js embedding test --enable --provider siliconflow --api-key-env SILICONFLOW_API_KEY
node dist/cli.js rerank test --enable --provider siliconflow --api-key-env SILICONFLOW_API_KEY
```

真实密钥必须留在仓库外。不要把 `.key.yaml`、环境变量值、Authorization header 或任何明文 API key 写入 README、源码、测试、报告或提交产物。

真实 SiliconFlow 验收必须显式执行，不能把 fake/offline 结果当作线上成功：

1. 在 Dashboard 设置中选择 SiliconFlow，通过 SecretRef 或 `SILICONFLOW_API_KEY` 提供密钥，并分别点击“测试 Embedding”和“测试 Rerank”。
2. 对当前知识工作区运行 `knowledge vector build`，确认 vector manifest 的 provider、model、dimensions、distance 与当前配置兼容。
3. 运行 `embedding test`、`rerank test`，再运行 `retrieval eval --questions ... --report ...`。
4. 检查报告的 Recall@5、MRR、直答精度、拒答准确率和必须升级准确率；报告不得包含密钥、Authorization、原始向量、provider 完整 payload 或完整文档正文。

缺少凭证时应记录 `not run`，不要临时把真实验收改写成 fake 成功。

## 开发

改代码前先阅读：

- [仓库开发规则](AGENTS.md)
- [开发标准](docs/standards/development.md)
- [技术架构](docs/architecture/overview.md)
- [Agent 设计](docs/architecture/agents.md)
- [产品 Agent 说明](src/agents/README.md)
- [主 Agent 配置](src/agents/main.md)

常用验证：

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

主要实现入口：

- Setup Dashboard、草稿、运行记录、进度和配置提交在 `src/onboarding/`。
- HTTP 启动和路由组合在 `src/gateway/http-server.ts`。
- 设置保存、SecretRef 应用、public settings 映射和 provider/model smoke test 编排在 `src/settings/`。
- CLI 主分发在 `src/cli/main.ts`，复杂命令适配器使用 `src/cli/command-*` 命名。
- 产品 Agent 配置在 `src/agents/`，阶段配对在 `src/agents/registry.json`。
- 运行时编排在 `src/runtime/diagnostic-runtime.ts`。
- 多策略召回、候选融合、可选 rerank 和 retrieval trace 在 `src/retrieval/`。
- Embedding/Rerank provider 适配在 `src/providers/embedding/` 和 `src/providers/rerank/`。
- 企业知识库资产、pipeline 和可重建索引 artifact 在 `src/knowledge/`。
- Claude Code 诊断工作器内部实现位于 `src/workers/claude/`。
- 诊断案例仓库和诊断上下文工具在 `src/sessions/`。
- 诊断日志抽屉的展示转换在 `src/observability/log-blocks.ts`。
