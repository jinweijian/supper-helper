# 知识库回答

## 读者先看

本功能负责判断“知识库能不能直接回答”。它不是普通 RAG：检索相关不等于可回答，必须同时通过 Evidence Judge 和 RAG Answerability。

## 功能边界

| 负责 | 不负责 |
| --- | --- |
| 识别 module、intent、keywords、source type | 生成用户最终回复 |
| 调用 retrieval service 获取 evidence pack | 调用 Claude Code |
| 判断证据质量、freshness、provenance、answer span | 修改知识库 draft |
| 判断 evidence 是否覆盖 `AnswerGoal` | 发布 solved case |
| partial 时输出 covered claims 和升级焦点 | 绕过 Output Review |

## 输入与输出

| 输入 | 输出 |
| --- | --- |
| `resolvedQuery`、`AnswerGoal` | `KnowledgeRoute` |
| published knowledge indexes | `KnowledgeEvidencePack` |
| retrieval trace | Evidence Judge result |
| top evidence | RAG Answerability result |

## 正常流程

```text
Knowledge Router
  -> Retrieval Service
  -> Evidence Judge
  -> RAG Answerability
     -> full: knowledge DiagnosticResult
     -> partial: coveredClaims + missingElements + escalationFocus
     -> none/unknown: escalation context
```

## 直答门禁

| 门禁 | 要求 |
| --- | --- |
| 状态 | evidence 来自 active published knowledge |
| 新鲜度 | fresh 或未过期 |
| 质量 | `ok` 或 `info` |
| 溯源 | source document、source block、section path 完整 |
| 答案片段 | 有明确 answer span |
| 覆盖度 | 覆盖 `AnswerGoal.mustAnswerItems` |
| 风险 | 无冲突、无高风险、无未知 module |

Rerank top score 要达到 `0.70`。未运行 Rerank 时，只允许完整标题命中且至少两个非泛化多字符词匹配。BM25、向量相似度和 RRF 分数本身不能授权直答。

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| evidence 质量 warn/error | 阻断直答，只作为调查上下文 |
| evidence 只相关但不回答 | RAG Answerability 返回 `none` 或 `partial` |
| 功能概览问题且证据覆盖 | 可聚合多条 evidence 进入 Review |
| 补跑/脚本/命令类问题缺步骤参数 | 必须 partial 或升级 Worker |
| provider/rerank 不可用 | 保留 trace 状态，使用更保守的直答门禁 |

## 代码入口

- `src/runtime/knowledge-turn.ts`
- `src/runtime/knowledge-diagnosis.ts`
- `src/runtime/evidence-judge.ts`
- `src/runtime/rag-answerability-service.ts`
- `src/retrieval/service.ts`
- `src/retrieval/evidence-pack.ts`
- `src/knowledge/`

## 不负责什么

- 不生成最终用户回复。
- 不把 draft、repair plan、review record 当 active knowledge。
- 不在 `src/knowledge/` 里实现 provider 协议或 rerank 策略。
- 不因为 persona 是运营/客服就把功能说明强制改写成 bug 诊断。
