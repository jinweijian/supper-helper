# super helper Coding Agent Rules

**与用户交互的语言与文档全部要用中文交互**

**用途：这是仓库开发规范。**

后续 Codex、AI coding agent、人工开发者在修改本仓库代码时，走这个文件。

不要把本文件和产品 Agent 配置混用：

- `AGENTS.md` 约束“怎么开发这个项目”。
- `src/agents/` 约束“super helper 产品里的主 Agent 与子 Agent 应该怎么表现”。

请用中文与用户沟通。

本仓库不是随意 vibe coding 的项目。后续任何 AI coding、人工开发、重构、修复都必须遵守本文件、`docs/standards/development.md` 和 `docs/standards/module-boundaries.md` 的模块边界。

## 必读顺序

在修改代码前，先阅读：

1. `docs/standards/development.md`
2. `docs/standards/module-boundaries.md`
3. `docs/architecture/overview.md`
4. `docs/architecture/agents.md`
5. `src/agents/README.md`
6. `src/agents/main.md`

如果改动涉及 OpenSpec change，还必须先阅读对应 change 的 proposal/design/spec/tasks。

## 强制模块边界

- `src/gateway/` 只负责 HTTP、路由、DTO、请求响应序列化。不得写 Preflight、worker、review、presentation 业务决策。
- `src/runtime/` 只负责 Agent runtime 编排和运行时决策。不得直接写 HTTP 响应，不得解析 URL 或拼接 API DTO。
- `src/agents/` 只负责产品 Agent 配置和 `registry.json` 配对规则。不得写 runtime 编排、HTTP、worker 或持久化逻辑。
- `src/sessions/` 只负责 case repository port、case context、会话上下文构建。不得调用 Claude Code 或模型。
- `src/workers/` 只负责 worker port 和具体 worker adapter。不得直接回复用户，不得改写 case 会话主状态。
- `src/observability/` 只负责日志展示结构和可观测性转换。不得决定诊断流程。
- `src/cli.ts` 必须保持薄可执行入口；runtime、gateway、worker 的内部消费者必须直接导入所属模块，禁止重新创建根级或命令级私有兼容入口。

## 开发硬规则

- 新功能必须先确定所属模块；无法归属时先更新设计文档，不要直接写代码。
- 新功能、重构、provider 接入、检索策略、CLI 子命令必须遵守 `docs/standards/module-boundaries.md` 的分层、适配器和拆文件规则。
- 不允许把一个完整流程从入口文件一路写到底。
- 不允许把 contract、factory、adapter、CLI 输出、业务策略混在同一文件；出现混合时必须先拆边界或写 OpenSpec 说明过渡方案。
- 不允许在 route 里调用 Claude worker 或模型。
- 不允许让 Claude Code 或 MCP 工具直接生成用户最终回复。
- 不允许把产品 Agent prompt/config 写到根目录、runtime helper、worker adapter 或普通 docs 中；必须放在 `src/agents/` 并登记到 `registry.json`。
- 不允许绕过 `DiagnosticRequest` / `DiagnosticResult` / Evidence Review contract。
- `DiagnosticRequest.answerGoal` 是用户可见回答目标的唯一权威；不允许重新用 `userGoal` 或自然语言问法枚举驱动 runtime 决策。
- `answerGoal.diagnosticObjective` 只服务内部排查；不允许进入用户主答、`directAnswer` 或结论第一句。
- `DiagnosticClaim` 必须声明 `role` 和 `answers`；无 role/answers 的 claim 必须在审核层失败或降级，不允许写兼容补锅逻辑。
- `final_answer` 必须有 accepted `primary_answer` 覆盖 `answerGoal.mustAnswerItems`；`process_note`、`evidence_locator`、`supporting_context` 不允许成为主结论。
- Presentation 只能表达 runtime 冻结的 primary answer claim IDs；不允许通过“能不能/下一步/哪个目录”等中文问法列表选择主答。
- Presentation 只能引用 selected accepted claims 直接绑定的 evidence，且完整用户可见 reply 都必须通过未审核事实校验；不允许只校验第一段后在后文追加事实。
- 证据不足但存在已接受的 fact/inference 时，fallback 必须优先展示“初步判断”，并明确不能作为最终结论；不允许用“暂不能形成最终结论”覆盖掉已接受的关键判断。
- 内部过程说明、Evidence Judge 分数、路由过程、worker trace、provider payload 只能进入日志/审计层；不允许混入主回复。
- 不允许无证据输出最终结论；事实、推断、假设、未知必须区分。
- 不允许破坏现有 API response shape，除非 OpenSpec 明确变更并更新兼容测试。
- 不允许修改持久化 case JSON shape，除非有迁移策略和测试。

## 每次改动最低验证

- 文档或结构改动：运行 `pnpm lint`。
- TypeScript 改动：运行 `pnpm typecheck`。
- 构建相关改动：运行 `pnpm build`。
- 运行时、gateway、worker、session、agent 行为改动：运行 `pnpm test`。

无法运行验证时，必须在最终回复中说明原因和风险。
