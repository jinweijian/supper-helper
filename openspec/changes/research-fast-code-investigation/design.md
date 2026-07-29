# research-fast-code-investigation 实验设计

## Context

当前 worker 路径：`DiagnosticRuntime.runTurnPipeline` 串行执行 preflight → experience → knowledge → MCP → `WorkerDiagnosisService.diagnose` → `ClaudeCodeWorker.diagnose`。`ClaudeCodeWorker` 每次 spawn `claude -p --output-format json`（`claude-code-worker.ts`），无 `--model` pin、无 max-turns、有 `--max-budget-usd` 可选；session 用 `--session-id`/`--resume` 复用上下文但进程不复用。

历史 case 已落盘在 `storage.rootDir/cases/*.json`，每个 run 含 `workerTrace.startedAt/finishedAt/exitCode` 与 `request`/`result`——baseline 数据已存在，可离线分析。

## Goals / Non-Goals

**Goals:**

- 用真实问题集量化现状 CC worker 的延迟分布与质量基线。
- 同一问题集上对比 3 个候选方案的延迟、质量、token 成本。
- 产出可执行的选型结论（选哪个、或与 CC 如何组合成双速 worker）。

**Non-Goals:**

- 不改 `src/` 任何生产代码；spike 不接 runtime pipeline。
- 不评估业务规则自研排查与重型外部服务。
- 不在本 change 内做 pipeline 并行化改造（只记录为后续选项）。
- 不追求 spike 代码质量/测试覆盖，够用即可；选定方案后实施 change 再做正式实现。

## 实验设计

### 评测集（~20-30 题）

从历史 case 抽取满足以下条件的问题：该回合走到了 worker（run 含真实 workerTrace 且非 mock）、worker 返回了可用结果。按三级分类（参考 `userGoal`/`answerGoal.resolvedQuestion`）：

| 分级 | 定义 | 预期占比 |
| --- | --- | --- |
| L1 事实查找 | 配置项、功能支持与否、入口位置、字段来源 | ~60% |
| L2 多跳推理 | 需要跨文件追踪调用链/状态变化 | ~25% |
| L3 模糊排查 | 描述现象、需要形成假设并验证 | ~15% |

抽样脚本读取 `cases/*.json`，输出 `benchmark/questions.jsonl`：`{id, level, question, workspaceRoot, referenceClaims}`（referenceClaims 取历史 run 的 accepted claims 作为质量参照）。

### 指标

| 指标 | 来源 |
| --- | --- |
| 端到端延迟 | spike 计时；baseline 用 workerTrace 时间戳 + 重跑实测 |
| token 成本 | 模型返回 usage / CC JSON 输出 costUsd |
| 可审核率 | spike 输出过 `validateDiagnosticResult` 的比例（fact 有 medium/high evidence、primary_answer 形状等） |
| 回答质量（人工） | 1-5 分：是否解决原始问题、步骤是否可执行；每方案每级抽 ≥5 题人工评 |
| 实现/维护成本 | 定性：代码量、索引重建策略、依赖 |

### Spike A：Code RAG

最小实现：行级/函数级 code chunker（先按文件分块 ~800 字符 + 文件路径前缀，不引入 tree-sitter）→ 复用现有 embedding provider 与 BM25（`src/retrieval` 可复用部分直接 import，spike 内自建轻量版亦可）→ top 8 chunks → 单次 `createModelClient` 调用，prompt 套用现有 worker system prompt 的精简版 → 输出 `DiagnosticResult` JSON。

关键假设：L1 事实查找类问题中，检索命中率足够高，单次合成即可产出可审核 claims。

### Spike B：CC 降速版

同一 `claude -p` 调用方式，加 `--model <快速档>` 与 max-turns 限制（如 `--max-turns 6`），其他不动。验证"同一个 engine 换小模型限轮次"的延迟/质量弹性。

### Spike C：打包式

用检索（同 A 的召回）选出 top N 文件/片段打包进单条 prompt（repomix 模式），单次 LLM 调用输出 `DiagnosticResult`。与 A 的差异：A 用 chunk 级证据，C 用文件级上下文。若工作区很大，C 可退化为"A 的粗粒度版"。

### 运行方式

每题每方案跑 1 次（L1 可对 A/C 跑 2 次取均值，波动大再增加），结果写 `benchmark/results/<spike>/<questionId>.json`。汇总脚本生成对比表。

### 决策矩阵（产出）

| 维度 | 权重（建议） | 说明 |
| --- | --- | --- |
| L1 延迟 p50 | 高 | 事实查找类是主要体感来源 |
| 全级质量（人工） | 高 | 不能为解决速度牺牲可用性 |
| 可审核率 | 高 | 必须过现有 review gate 才能进 pipeline |
| token 成本 | 中 | 单题 USD 对比 |
| 实现/维护 | 中 | 索引重建、依赖、代码量 |

结论形态：单选 / 双速组合（fast path 处理 L1、CC 处理 L2/L3）/ 维持 CC+降速参数。

## Risks / Trade-offs

- 评测集偏小或分级不准 → 结论失真 → 抽样时人工过一遍题目分级，每级 ≥5 题。
- spike 实现质量影响延迟数字 → spike 只做公平的最小实现，记录实现备注；对比看数量级差异而非毫秒差。
- 历史 referenceClaims 本身质量参差 → 人工评分以"是否解决原始问题"为准，referenceClaims 只作参照。
- 重跑 baseline 消耗 CC quota → 评测集控制在 30 题内，baseline 优先用历史 trace 统计。

## Open Questions

- workspace 代码规模多大？决定 Spike C 是否可行（打包上下文上限）。
- 快速档模型选哪个（Haiku 级/其他 provider）？Spike B 前先确认可用模型清单。
- 是否把"并行化（worker 与 knowledge 并行）"也做一个 5 题的小验证？成本低，建议附带。
