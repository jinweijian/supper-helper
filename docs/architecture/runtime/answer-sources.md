# 答案来源选择

## 读者先看

本功能决定“先从哪里找答案”。顺序是从低成本、高可控的来源开始：历史经验、知识库、只读 Worker。无论来源是什么，结果都必须进入统一 Review。

## 功能边界

| 来源 | 适合回答 | 必须升级的情况 |
| --- | --- | --- |
| Experience | 同用户/同 workspace 下已审核且仍有效的历史答案 | 来源不明、过期、质量不合格、未覆盖当前 `AnswerGoal` |
| Knowledge | 产品规则、FAQ、runbook、whitepaper、已发布 solved case | 证据只相关但不回答、质量 warn/error、实现细节不足 |
| Worker | 代码位置、实现逻辑、配置、只读 workspace 检查 | 权限不足、高风险写操作、证据仍不足 |

## 输入与输出

| 输入 | 输出 |
| --- | --- |
| `AnswerGoal`、`resolvedQuery` | `DiagnosticResult` candidate |
| 当前 case context | history / knowledge / worker evidence |
| workspace 和 knowledge 配置 | Review 可审核的 claims |

## 正常流程

```text
Preflight dispatch
  -> Experience
     -> hit: history result
     -> miss: Knowledge
  -> Knowledge
     -> full: knowledge result
     -> partial/none/unknown: Worker
  -> Review
```

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| Experience 命中但当前 scope 不再有效 | 拒绝复用，写入候选拒绝原因 |
| Knowledge 没命中 | 带 no-hit context 升级 Worker |
| Knowledge partial | 保留 covered claims，把 missing elements 交给 Worker |
| Worker 失败 | 转成结构化 partial/need_input，再进入 Review |
| 所有来源都不足 | Review 决定追问、partial 或人工升级 |

## 代码入口

- `src/runtime/experience-turn.ts`
- `src/runtime/experience-agent.ts`
- `src/runtime/knowledge-turn.ts`
- `src/runtime/knowledge-diagnosis.ts`
- `src/runtime/worker-diagnosis.ts`
- `src/runtime/review-presentation.ts`

## 不负责什么

- 不绕过 Review 直接回复。
- 不把历史 case 当当前事实。
- 不因为知识库高分相关就默认直答。
- 不让 Worker 修改项目或生产环境。
