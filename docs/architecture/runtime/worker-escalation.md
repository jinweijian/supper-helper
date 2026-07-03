# Worker 升级

## 读者先看

当历史经验和知识库不能完整回答 `AnswerGoal` 时，Runtime 才升级只读 Worker。Worker 是工具，不是产品 Agent；它返回结构化结果，不能直接回复用户。

当前默认 Worker adapter 是 Claude Code Worker。

## 功能边界

| 负责 | 不负责 |
| --- | --- |
| 构造 `DiagnosticRequest` | 解析 HTTP DTO |
| 附加 case context、knowledge context、deep query context | 选择最终用户结论 |
| 调用 `DiagnosticWorker` port | 修改 workspace |
| 解析 Worker failure 为结构化结果 | 持久化长期记忆 |
| bounded follow-up / Deep Query Retry | 绕过 Review |

## 输入与输出

| 输入 | 输出 |
| --- | --- |
| `DiagnosticRequest` | `DiagnosticResult` |
| allowed MCP tool IDs | `WorkerTrace` |
| workspace path | follow-up request（必要时） |
| knowledge partial context | Review 可消费的 claims/evidence |

## 正常流程

```text
buildDiagnosticRequest
  -> attach context
  -> DiagnosticWorker.diagnose
  -> parse output / failure
  -> optional follow-up DiagnosticRequest
  -> Review
```

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| Claude CLI 输出无法解析 | 转为 partial/need_input 结构化结果 |
| reused session busy | adapter 做有限重试 |
| 第一轮证据不足但可继续 | Runtime 生成 follow-up request |
| 达到 retry 停止条件 | 当前 partial 进入 Review，不无限循环 |
| Worker 没有 usable evidence | Presentation 只展示安全失败类别、状态、下一步和 case/run |

## 代码入口

- `src/runtime/request-builder.ts`
- `src/runtime/worker-diagnosis.ts`
- `src/runtime/worker-turn.ts`
- `src/runtime/deep-query-planner.ts`
- `src/workers/diagnostic-worker.ts`
- `src/workers/claude/claude-code-worker.ts`
- `src/workers/claude/claude-prompts.ts`
- `src/workers/claude/claude-policy.ts`
- `src/workers/claude/claude-cli.ts`
- `src/workers/claude/claude-output-parser.ts`

## 不负责什么

- 不生成用户最终回复。
- 不把 Worker stdout/stderr 直接暴露给主聊天。
- 不请求默认写操作。
- 不读取另一个 case、tenant、user 或 workspace 的上下文。
