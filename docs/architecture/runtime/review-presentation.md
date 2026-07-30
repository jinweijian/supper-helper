# 审核与表达

## 读者先看

所有答案来源都会进入同一套审核表达流程。Review 决定“能不能这样答”，Presentation 只决定“怎么用中文表达”。

## 功能边界

| 负责 | 不负责 |
| --- | --- |
| 校验 evidence ID 和 claim 引用 | 选择新的答案来源 |
| 校验 fact 证据强度 | 修改 Worker 结果事实 |
| 校验 claim `role` 和 `answers` | 提升 outcome |
| 冻结 accepted claim/evidence IDs | 引用未选中 evidence |
| 校验 Presentation 输出 | 增加未审核事实 |

## 输入与输出

| 输入 | 输出 |
| --- | --- |
| `DiagnosticResult` | `ValidatedDiagnosticResult` |
| `AnswerGoal` | frozen review decision |
| accepted claims/evidence | helper reply |
| persona | case status |

## 正常流程

```text
DiagnosticResult
  -> Result Validator
  -> Review Gate
  -> Presentation model
  -> deterministic presentation validation
  -> helper reply or fallback presenter
```

## Review 规则

| 规则 | 要求 |
| --- | --- |
| fact | 必须引用 medium/high evidence |
| primary answer | `final_answer` 必须有 accepted `primary_answer` 覆盖 must-answer items |
| process note | 不能成为用户主结论 |
| evidence locator | 只能作为辅助信息 |
| unknown | 未覆盖项必须保留 |
| partial | 有 accepted fact/inference 时先给“初步判断”，再说明证据不足 |

## Presentation 规则

- 只能返回 frozen primary/supporting/action/evidence ID 的排序和封闭 layout。
- primary ID 集合必须等于 runtime 冻结的 primary answer claim IDs。
- 完整可见回复必须落在 accepted claims/evidence/missingInfo 内。
- 引用 evidence 必须来自 selected accepted claims。
- 校验失败时使用本地 fallback presenter。

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| Worker 返回无证据 fact | 拒绝或降级 |
| primary answer 未覆盖 AnswerGoal | 不能 final，改 partial/ask_user/escalate |
| Presentation 新增事实 | 丢弃模型回复，使用 fallback |
| Presentation 引用越界 evidence | 丢弃模型回复，使用 fallback |
| pre-result Worker failure | 只展示安全失败类别、诊断状态、下一步、case/run |

## 代码入口

- `src/runtime/result-validator.ts`
- `src/runtime/review-gate.ts`
- `src/runtime/review-presentation.ts`
- `src/runtime/presenter.ts`
- `src/runtime/event-recorder.ts`
- `src/agents/output-review.md`
- `src/agents/presentation.md`

Coverage review 使用 source-neutral safe segments。producer 的 `answers` 只是候选：
独立 reviewer 给出 claim→item bindings、完整问题状态和
`fullQuestionClaimIds`，runtime 再冻结 greedy item cover 与 required full-question claims 的稳定并集。
Knowledge 仅接受当前 active v4 generation，Workspace/Log 仅接受当前 run，MCP 仅接受当前
allowlisted read-only call，manual 仅接受当前 source message；history/unknown 不产生 coverage segment。

Presentation 只接收 `SafeFrozenAnswerProjection`。模型与 fallback renderer 使用同一份已脱敏、
有界、带 provenance 的 projection；raw result、summary、trace 和未选 evidence 在类型和生产组合上均不可达。

## 不负责什么

- 不重新检索知识库。
- 不再次调用 Claude Code。
- 不修改 runtime 冻结的 accepted IDs。
- 不把内部评分、Worker trace 或 provider payload 混入主回复。
