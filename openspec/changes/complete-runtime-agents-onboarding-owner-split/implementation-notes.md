# Implementation Evidence

## 结构基线与红灯

- 初始结构：`src/runtime/event-recorder-impl.ts` 约 809 行，phase owner 是一行 marker；`src/onboarding/run-service.ts` 约 905 行，draft/review/secrets 是重复 re-export；`src/agents/main.md` 770 行并重复阶段合同。
- RED 命令：`pnpm typecheck && pnpm build && node --test test/runtime-hardening.test.mjs test/conversation-evidence-lifecycle.test.mjs test/runtime-onboarding-owner-reachability.test.mjs`。
- RED 结果：owner reachability 检测到 Onboarding duplicate re-export 和 Main 超长；新增 facade 委派测试在旧实现报 `dependencies.drafts` 未定义，证明测试没有只检查文件存在。
- 结构门禁同时检查：claimed owner 最小有效行数、300 行预算、聚合器生产 import、禁止 marker/giant implementation、禁止 owner 反向 import facade、公共 symbol identity。

## Event Recorder owner 证据

- 生产入口：`src/runtime/event-recorder.ts` 保持公共兼容导出，真实聚合在 `src/runtime/event-recorder/index.ts`；聚合器直接 import conversation/preflight/knowledge/review/curator/worker 六个 owner。
- owner 行数：conversation 144、preflight 156、knowledge 239、review 116、curator 99、worker 48；共享 sink/base 82，聚合器 22。
- 事件兼容：生产 owner 共保留 47 个既有 phase；`runtime-hardening` 验证 model/worker 原始输出脱敏、judge 结果快照和 evidence ID 引用。
- 证据对象边界：`knowledge_search_result` 是唯一保存完整 KnowledgeEvidencePack 的事件；preflight、DiagnosticRequest、review 和 answer selected 只保存 evidence IDs，不重复来源路径或 evidence 对象。
- GREEN 命令：`pnpm typecheck && pnpm build && node --test test/runtime-hardening.test.mjs test/conversation-evidence-lifecycle.test.mjs test/runtime-onboarding-owner-reachability.test.mjs`。
- GREEN 结果：Event Recorder 相关断言全部通过；完成整个 change 后 focused 集合 50/50 通过。

## Onboarding owner 与真实 HTTP/SSE 证据

- `OnboardingDraftService`（53 行）：有效草稿、保存、验证和公开状态。
- `OnboardingSecretsService`（185 行）：拒绝明文危险输入、SecretRef 保留/写入、公开草稿脱敏、运行时 materialize 和知识 workspace 解析。
- `OnboardingReviewService`（135 行）：审核 action、选择目标、发布、索引和 run counter 更新；review state 及逐问题解释分别为 157/142 行的职责 helper。
- `OnboardingRunService`（77 行）：start/get/retry/subscribe/recover；`service-factory.ts`（91 行）只做 repository、runner 和 owner 组合。
- `OnboardingService` facade 51 行，只委派 public use case；旧构造依赖和 `createOnboardingService`/`OnboardingService` export identity 保持兼容。
- RED：`node --test --test-name-pattern='Onboarding facade delegates' test/runtime-onboarding-owner-reachability.test.mjs` 在旧 giant service 失败。
- GREEN focused：`pnpm typecheck && pnpm build && node --test test/onboarding.test.mjs test/onboarding-http.test.mjs test/module-boundaries.test.mjs test/runtime-onboarding-owner-reachability.test.mjs`，58/58 通过。
- 本地真实验收：`pnpm build && node --test --test-name-pattern='production onboarding HTTP' test/onboarding-http.test.mjs`，1/1 通过。真实 Node server 经 `/api/onboarding/draft` 保存草稿和 SecretRef，经 `/api/onboarding/runs` 启动，SSE 返回 `run.snapshot`，轮询真实 run repository 最终得到 `completed`、`overallProgress=100`；响应不含提交的 secret。
- 外部 provider 没有使用真实凭证：验收只对 `api.example.test` 使用确定性 smoke response，HTTP、文件系统、知识流水线、SSE 和 repository 均是真实生产入口。真实厂商连通性仍取决于部署凭证，未伪装为已验证。

## Main Agent 权威配置证据

- `src/agents/main.md` 从 770 行收敛到 99 行，只保留身份、AnswerGoal ownership、全局 workflow、证据/隐私、安全和 Case-scoped memory。
- 阶段 schema 和示例只由 `registry.json` 对应配置及稳定代码 contract 定义；Main 不再出现 `## Preflight Gate`、`## DiagnosticResult`、`## Output Review` 或 `## Prompt Regression Cases` 的重复章节。
- Claude session 明确为 Case-scoped/per-case：同 Case `--resume`，当前 DiagnosticRequest 和 CaseRepository 仍是权威；不同 Case 不共享。
- 验证：`pnpm lint` 通过；`node --test test/answer-goal.test.mjs test/turn-presentation-integrity.test.mjs test/runtime-onboarding-owner-reachability.test.mjs` 通过；注册表解析 main/input-review/preflight/experience/knowledge/MCP/review/presentation/curator 全部成功。
- 全量测试中的 `/api/agents`、Runtime prompt assembly、preflight、presentation 和 case curator 契约均通过。

## Anti-Fake-Complete Review

- 删除实验：临时移除 `src/runtime/event-recorder/conversation.ts` 后 `tsc --noEmit` 因生产 Runtime 方法和聚合 import 缺失而失败；临时移除 `src/onboarding/draft-service.ts` 后 factory/facade import 失败。文件均在同一命令 trap 中恢复。
- import 图检查：没有 `event-recorder-impl`；四个 Onboarding owner 均不 import `service.ts`；Gateway 仍只调用公开 Onboarding facade，factory 真实实例化四个 owner。
- 过度拆分检查：Event 文件按事件 phase 语义聚合；Onboarding 文件按 draft/review/run/secrets 用例聚合。review state 与 issue explanation 被拆出是因为它们分别负责文件投影和用户可读解释，不是按任意行号切片。
- 审计发现并修复 1：最初迁移把细分类 review explanation 简化成通用文案，测试虽能通过但会降低真实 Setup 体验。已恢复所有原有原因/影响/建议，并增加 `not_answer_bearing` 精确回归断言。
- 审计发现并修复 2：旧 module-boundary 测试把所有 facade 统一限制为 40 行，与本 change 的真实组合 facade 冲突。现保留旧 re-export facade 的 40 行门禁，对 Onboarding 单独执行 80 行窄 facade 门禁，并由行为测试验证每个 public method 的 owner 委派。
- 审计结论：owner 可独立理解和替换，生产数据真实经过 owner；测试同时覆盖 import 失败、真实 HTTP/SSE、真实文件落盘和公共 symbol，不存在只创建文件或只 mock 内部函数的假完成。

## 最终验证

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，Dashboard/Setup Vite 产物生成。
- `pnpm test`：381/381 通过。
- `pnpm test:web`：5 files、12/12 通过。
- `pnpm test:e2e`：Playwright Chromium 2/2 通过。
- API Key UI 补充回归：Setup 根据 `hasApiKey` 显示“留空保留原记录”或“留空则不设置”，组件测试先红后绿；不回显密钥、不改变空值不覆盖旧 SecretRef 的后端语义。

## 剩余风险

- 未使用真实外部 Agent/Embedding/Rerank 厂商凭证执行本 change 的远程 acceptance；本地测试覆盖安全降级和 provider contract，但不能证明当前部署凭证、配额或网络可用。
- LAN 仍按明确范围保持无鉴权内测模式；本 change 未增加登录、token 或租户授权。
