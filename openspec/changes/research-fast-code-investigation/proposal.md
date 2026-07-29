# research-fast-code-investigation

## Why

Claude Code Worker 是当前唯一真正查代码的环节，但用户体感"CC 回答较慢"。机制上：每次 `diagnose()` 新 spawn CLI 进程、agentic 循环 N 轮全量推理、未 pin 模型、无 max-turns 限制，且 worker 排在 pipeline 最后串行等待。worker 收到的查询大部分是**事实查找类**（配置/支持与否/入口），agentic 循环对这类问题是过度方案。

在承诺任何架构改造（fast investigator / code RAG / 换工具）之前，需要用**真实问题集 + 可量化指标**对比候选方案，避免凭体感选型。本 change 是纯调研：不改生产行为，只产出实验数据与选型决策。

## What Changes

- 建立**真实问题评测集**：从历史 case（`storage.rootDir/cases/*.json`）抽取走过 worker 的真实问题，按"事实查找/多跳推理/模糊排查"分级。
- 测量**现状 baseline**：从历史 run 的 `workerTrace.startedAt/finishedAt` 统计 CC worker 延迟分布；对评测集重跑现状记录延迟/token/可审核率。
- 实现并测量 **3 个候选 spike**（最小可跑原型，不接 runtime、不进 `src/`）：
  - Spike A：Code RAG——workspace 代码 chunk 索引（复用现有 BM25/embedding provider）+ 单次模型合成 `DiagnosticResult`。
  - Spike B：CC 降速版——pin 快速档模型 + max-turns/budget 限制。
  - Spike C：打包式——相关文件打包（repomix 模式）+ 单次 LLM 调用。
- 产出**决策矩阵**（延迟 × 回答质量 × token 成本 × 实现/维护成本）与选型结论文档。
- 明确**不评估**的项：业务规则自研排查（已判定维护成本过高）、重型外部服务（Sourcegraph 等）。

## Capabilities

### New Capabilities

- `worker-investigation-evaluation`: 调研交付物的验收标准——评测集构成、必须记录的指标、决策矩阵内容与选型结论的产出要求。

### Modified Capabilities

（无——本 change 不改任何生产行为。）

## Impact

- **代码**：spike 原型只放 `openspec/changes/research-fast-code-investigation/spikes/`，不进 `src/`，不违反模块边界；选定方案后另行立实施 change。
- **数据**：只读历史 case 文件；评测重跑使用现有 CLI/服务但不改其代码。
- **成本**：spike 会消耗少量模型 token（评测集规模控制在 20-30 题）。
- **交付**：调研结论文档 + 决策矩阵，作为后续 `add-fast-code-investigator`（或放弃该方向）的依据。
