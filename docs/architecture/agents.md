# 产品 Agent 设计

`super helper Agent` 是用户、知识库、MCP 工具和 Claude Code Worker 之间的中间层。它拥有本轮 `AnswerGoal`，负责决定何时追问、何时派发诊断、如何审核证据，以及最终如何向用户表达。

权威产品 Agent 配置在 [`src/agents/`](../../src/agents/README.md)，不是本目录。本页解释这些 Agent 为什么存在、彼此边界是什么。

## 核心原则

- **不能乱猜**：无证据不输出最终结论。
- **证据不足必须追问**，或明确标记为 unknown / 初步判断。
- **Claude Code 不直接回复用户**；它只是只读诊断工具。
- **DiagnosticRequest 是 Worker 的唯一输入契约**；不得把用户原话直接当 Worker 指令。
- **Presentation 只表达 Review 冻结结果**；不能新增事实、提升 outcome、泄漏内部 trace。

## Agent 分工

| Agent | 运行阶段 | 职责 | 用户可见文本 |
| --- | --- | --- | --- |
| Main Agent | 全回合 | 拥有 `AnswerGoal`，协调子 Agent 和工具结果 | 最终负责 |
| Input Review / Preflight Gate | 问题契约前置 | 判断是否追问或派发，只能用当前 case/context | 可产生追问 |
| Experience Agent | 答案来源 | 复用同 tenant/user/workspace 下仍有效的历史答案 | 不直接产生 |
| Knowledge Router | 知识检索前 | 识别 module、intent、keywords、代码升级信号 | 不直接产生 |
| Evidence Judge | 知识证据门禁 | 判断知识证据是否足够直答或必须升级 | 不直接产生 |
| RAG Answerability | 知识覆盖判断 | 判断 evidence 是否覆盖 `AnswerGoal`，partial 时萃取 covered claims | 不直接产生 |
| Output Review | 证据审核 | 校验 claim/evidence，冻结 outcome 和 accepted IDs | 不直接产生 |
| Presentation | 表达 | 基于 accepted claim/evidence 写中文回复 | 可产生 |
| Case Curator | 解决后沉淀 | 用户确认解决后生成 `review_required` solved case 草稿 | 不直接产生 |

## 边界关系

```text
用户问题
  -> Main Agent 持有 AnswerGoal
  -> Input Review 决定追问或派发
  -> Experience / Knowledge / Worker 产生 evidence 和 claims
  -> Output Review 冻结 accepted claim IDs
  -> Presentation 表达冻结结果
  -> Case Curator 在用户确认解决后沉淀草稿
```

这个图只表达职责流，不代表代码调用细节。代码级用户回合拆分见 [Runtime 总览](runtime/README.md)。

## 关键合同

| 合同 | 说明 | 详情 |
| --- | --- | --- |
| `AnswerGoal` | 本轮用户可见回答目标，所有 Agent 共享 | [问题契约](runtime/question-contract.md) |
| `DiagnosticRequest` | Worker 只接收这个结构化请求 | [Worker 升级](runtime/worker-escalation.md) |
| `DiagnosticResult` | Experience、Knowledge、Worker 返回给 Review 的统一结果 | [核心契约](runtime/contracts.md) |
| `DiagnosticClaim` | 事实、推断、假设、未知都必须带 role/answers 边界 | [审核与表达](runtime/review-presentation.md) |
| Presentation output | 表达层 JSON 合同，必须绑定 accepted IDs | [核心契约](runtime/contracts.md) |

## 不做什么

- 不把 Agent prompt/config 写进 runtime、worker、gateway 或普通 docs。
- 不让 MCP 或 Claude Code 绕过 Output Review。
- 不用用户问题里的中文关键词列表决定主结论。
- 不把 `answerGoal.diagnosticObjective` 放进用户主答。
- 不把内部过程、Evidence Judge 分数、Worker trace 或 provider payload 混进主回复。

## 当前配置入口

- [`src/agents/main.md`](../../src/agents/main.md)
- [`src/agents/input-review.md`](../../src/agents/input-review.md)
- [`src/agents/experience.md`](../../src/agents/experience.md)
- [`src/agents/knowledge-router.md`](../../src/agents/knowledge-router.md)
- [`src/agents/evidence-judge.md`](../../src/agents/evidence-judge.md)
- [`src/agents/rag-answerability.md`](../../src/agents/rag-answerability.md)
- [`src/agents/output-review.md`](../../src/agents/output-review.md)
- [`src/agents/presentation.md`](../../src/agents/presentation.md)
- [`src/agents/case-curator.md`](../../src/agents/case-curator.md)
- [`src/agents/registry.json`](../../src/agents/registry.json)
