## 1. Turn 身份与上下文截止

- [x] 1.1 先为 `AcceptedUserTurn`、消息 ID completion 和相同正文绑定编写失败测试。**验收目标：** 测试必须通过真实 `DiagnosticRuntime + FileMemoryStore` 证明正文不再用于定位回合。**红灯：** `pnpm build && node --test test/turn-presentation-integrity.test.mjs` 应因现有正文接口或错误 replyTo ID 失败。**绿灯：** 新接口测试通过且既有 sync/async shape 测试不变。**完成证据：** implementation-notes 记录失败断言、通过数量和生产调用链。
- [x] 1.2 实现只读 `TurnContextSnapshot` 并迁移 Preflight、Experience、Knowledge、Worker context。**验收目标：** 两条异步消息先后接受但第一条尚未完成时，第一条所有阶段均看不到第二条。**红灯：** 垃加真实并发 acceptance，断言第一条 DiagnosticRequest 含第二条消息并失败。**绿灯：** `node --test test/turn-presentation-integrity.test.mjs test/supper-helper.test.mjs` 通过。**完成证据：** 保存两条 request 的 sourceMessageIds/recentMessages 摘要，不保存原始敏感正文。

## 2. 确定性 Presentation

- [x] 2.1 先为 ID-only `PresentationPlan`、额外事实、Q2 特判、Judge score 和未选 claim 编写失败测试。**验收目标：** 恶意模型即使返回合法 IDs，也不能让任何新增事实出现在完整回复。**红灯：** focused test 必须在现有自由 `reply` 路径上失败。**绿灯：** `node --test test/conversation-evidence-lifecycle.test.mjs test/turn-presentation-integrity.test.mjs` 通过。**完成证据：** 记录每个被阻止字符串及对应 fallback 输出摘要。
- [x] 2.2 实现 reviewed projection、ID-only planner validator 和确定性 persona renderer，删除业务关键词/固定风险路径。**验收目标：** 完整回复中的事实句都能映射到 selected accepted claim，process_note 与内部分数只在日志。**红灯：** 先加入逐段映射失败测试。**绿灯：** focused tests 与 `pnpm typecheck` 通过。**真实验收：** 使用真实 Runtime 和模型 adapter 的本地 HTTP stub 走完整 model presentation 路径。**完成证据：** implementation-notes 写明 selected IDs、可见段落映射和降级原因。

## 3. Claude Case 会话合同与兼容

- [x] 3.1 更新 Main/Worker/架构文档和回归测试，统一为 Case-scoped Claude session。**验收目标：** 首 run 使用 session-id，后续 run 使用 resume，但每次 payload 都含完整 DiagnosticRequest，且不同 Case sessionId 不同。**红灯：** 文档一致性测试先因现有 per-run 文案失败。**绿灯：** Agent docs lint、worker prompt tests、`pnpm lint` 通过。**完成证据：** 列出删除的冲突陈述和保留的权威记忆规则。
- [x] 3.2 运行生产路径与全量回归。**验收目标：** `/api/chat` sync/async、history、knowledge、worker、review、presentation 均保持公开 shape。**命令：** `pnpm lint && pnpm typecheck && pnpm build && pnpm test`。**外部显式验收：** 有真实模型凭证时运行 presentation acceptance；无凭证必须记录未验原因、影响和风险。**完成证据：** 记录命令退出码、测试总数和外部验收状态。

## 4. 回头重新思考 / Anti-Fake-Complete Audit

- [x] 4.1 从真实 `/api/chat` 重新追踪消息 ID、snapshot、AnswerGoal、Worker request、selected claims 到最终完整回复，主动构造后发消息、相同正文、恶意模型、Q2、process_note 和 Judge score。**完成条件：** 逐项证明生产控制流阻止串线与新增事实；检查测试是否只打 mock/旧 formatter；发现任何缺口必须先反向更新 design/spec/tasks 并补测试，最后在 implementation-notes 写出当前实现是否合理、仍有何风险。仅写"已检查"不得勾选。
