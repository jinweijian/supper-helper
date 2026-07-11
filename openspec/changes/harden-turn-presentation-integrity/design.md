## Context

同步与异步聊天共用 `DiagnosticRuntime`，但异步入口先写入所有新消息，再只对 complete 阶段排队。上下文构建读取 Case 最近消息，因而先发回合可能看到后发消息。Presentation 同时存在自由文本模型输出、本地关键词特判和 supporting claim 拼接，无法证明完整回复只来自冻结结论。

## Goals / Non-Goals

**Goals:**

- 让每个回合以 `userMessageId` 为稳定身份，并只读取该消息之前的 Case 视图。
- 让用户可见回复完全由 accepted claim/evidence/missingInfo 确定性生成。
- 保留同 Case Claude session 复用，同时消除文档中的 per-run 矛盾。

**Non-Goals:**

- 不改变 HTTP response shape、Case 顶层 JSON shape或同 Case 串行语义。
- 不改变 Claude 为只读 Worker 的权限模型。

## Decisions

1. `startUserTurn` 返回 `AcceptedUserTurn { caseSession, userMessageId }`；`completeUserTurn(caseId, userMessageId)` 从 repository 读取正文，不再按正文匹配。
2. 新增 `TurnContextSnapshot`，只包含目标 user message 及之前的 messages、runs 和 accepted evidence。决策服务消费 snapshot，持久化服务仍写实时 Case，避免保存旧快照覆盖后发消息。
3. 模型 Presentation 输出改为 `PresentationPlan`：section、tone、claimIds、evidenceIds、directAnswerClaimIds，不允许 `reply` 或自由事实文本。Runtime renderer 只渲染被选 claim 原文、accepted next action、missingInfo 与固定非事实连接语。
4. `process_note` 永不进入可见 projection；`supporting_context` 只有明确被选且不含内部评分/路由信息时可见；Evidence Judge 分数只保留日志。
5. 删除所有按用户问题关键词选择特殊答案模板的逻辑。需要特殊结构时由 reviewed claim role/answers 决定。
6. Claude session 继续按 Case 建立并在后续 run 使用 `--resume`；每次请求仍发送完整 DiagnosticRequest，跨 Case 不复用。

## Risks / Trade-offs

- [模型无法自由改写后表达可能更机械] → 使用受限 tone/section 计划和确定性 persona sanitizer，不允许以流畅度换取事实漂移。
- [snapshot 与实时 Case 分离可能导致错误保存] → snapshot 类型只读且不实现 repository mutation；所有写操作显式接收 live Case。
- [旧内部调用仍传正文] → 一次性迁移所有 runtime/gateway/test 调用并用编译失败阻止遗漏。

## Migration Plan

先增加失败测试，再迁移内部接口；HTTP DTO 保持不变。旧 Case message 已有 ID，无数据迁移。回滚时恢复内部接口即可，不改持久化数据。

## Open Questions

无。已确认 Claude session 按 Case 复用。
