# 架构阅读入口

本目录只描述当前实现架构，不承载产品 Agent prompt。产品 Agent 配置仍以 [`src/agents/`](../../src/agents/README.md) 和 [`src/agents/registry.json`](../../src/agents/registry.json) 为准。

## 建议阅读顺序

1. [系统总览](overview.md)：先看模块边界和五个功能块。
2. [产品 Agent 设计](agents.md)：看主 Agent 与子 Agent 的职责。
3. [Runtime 总览](runtime/README.md)：看用户问题如何被回答出来。
4. Runtime 功能文档：按你关心的边界继续读。

## Runtime 功能文档

| 文档 | 解决的问题 |
| --- | --- |
| [输入与会话](runtime/entry-session.md) | `/api/chat`、Case、同步/异步、队列边界 |
| [问题契约](runtime/question-contract.md) | `ResolvedTurnContext`、`AnswerGoal`、Preflight |
| [答案来源选择](runtime/answer-sources.md) | Experience、Knowledge、Worker 谁先谁后 |
| [知识库回答](runtime/knowledge-answering.md) | Knowledge Router、Retrieval、Evidence Judge、RAG Answerability |
| [Worker 升级](runtime/worker-escalation.md) | `DiagnosticRequest`、Claude Code Worker、Deep Query Retry |
| [审核与表达](runtime/review-presentation.md) | Result Validator、Review Gate、Presentation |
| [可观测性与沉淀](runtime/observability-curation.md) | EventRecorder、`/api/logs`、WorkerTrace、Case Curator |
| [核心契约](runtime/contracts.md) | `AnswerGoal`、`DiagnosticResult`、claim/evidence、Presentation output |

## 阅读原则

- 先看功能边界，再看时序细节。
- 总览图只帮助定位，不承担完整流程解释。
- 复杂分支看对应功能文档的表格，不在一张大图里追线。
