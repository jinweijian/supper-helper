## Context

本次 change 基于 2026-06-28 对 `src/` 代码与两条代表性服务会话审核日志的联合审查。审查发现三类系统性问题已经影响产品合同：

**审核日志卫生失控的当前状态**：
- `event-recorder.ts:156-168` `modelPreflightResult` 将模型原始输出完整写入 `detail.raw`，无 redaction、无 slice；而 `modelReviewResult`（line 269-281）已有 `redactProviderErrorMessage(raw).slice(0,2000)`。两个相位行为不一致。
- 同一批 8 条 evidence 在 `knowledge_search_result`、`knowledge_answer_selected`、`evidence_review_started`、`run.result.evidence` 中重复存储 4 次，导致 `case_816ea182` 70KB、`case_aae61669` 173KB。
- `development-standards.md` 的 "Preserve established phases" 列出 16 个 phase，但 `event-recorder.ts` 实际定义 40+ 个（`experience_*`、`knowledge_router_*`、`knowledge_search_*`、`evidence_judge_*`、`deep_query_*`、`case_review_*`、`case_curator_*` 等），文档与代码脱节。
- 知识直答路径（`case_816ea182`）有 `preflight_started` → `model_preflight_result` 但跳过 `preflight_decision`，审计断链。
- `user_reply` 对 `operations` persona 暴露 `source=knowledge/_sources/whitepapers/src_1c0bc3610f76/...docx` 内部路径。

**Deep Query Planner 的当前状态**：
- `deep-query-planner.ts:142-154` `likelyPathsFor` 硬编码 `src/**/*service*`、`src/**/*manager*`、`src/**/*repository*` 等后端路径假设。对 EduSoho（Symfony 项目，模板在 `web/themes/`、前端在 `vue3/`、配置在 `app/config/`）完全误导。
- `deep-query-planner.ts:126-140` `inferArtifactTargets` 硬编码 scheduler/queue/callback/state_machine/permission/payment/config/route/service 通用后端概念，正则不匹配时兜底落到 `service`（line 138），导致 `case_aae61669` 的"营销主题分类挂件"问题被错误指向 `src/**/*service*`，实际根因在 `web/themes/marketing/views/default/parts/banner.html.twig`。
- `deep-query-planner.ts:36-41` `anchorTerms` 直接合并 `route.keywords`，而 `route.keywords` 是 2-gram 滑窗切分（参考 `experience-agent.ts:222-224` 的 bigrams 实现），产生 "销主""题中""中关" 等无语义噪声。line 121 把它们拼成 `DiagnosticRequest.constraints`，干扰 Claude Code 判断。

**模块边界债务的当前状态**：
- 根目录散落 `src/model.ts`（直接 fetch `chat/completions`，是 model provider adapter）、`src/preflight.ts`（runtime Preflight 决策）、`src/storage.ts`（`FileMemoryStore` 是 case repository 实现，`sessions/file-case-repository.ts` 只剩 re-export）、`src/model-smoke-test.ts`。违反 `AGENTS.md` "禁止重新创建根级私有兼容入口"。
- `src/ui.ts` 2990 行、`src/knowledge/quality.ts` 855 行、`src/onboarding/service.ts` 806 行、`src/runtime/event-recorder.ts` 683 行、`src/setup-ui.ts` 642 行、`src/runtime/evidence-judge.ts` 483 行等超标，违反 `module-boundary-standards.md` "单文件超过约 300 行必须拆分"。
- `src/gateway/dto.ts:5-8,79-94` 在 DTO 序列化中编排 `buildKnowledgeHealthSummary + createConfiguredKnowledgeRetriever`；`src/gateway/routes/knowledge-routes.ts:3-9,30-88` route handler 直接编排 knowledge health/init/reindex；`src/gateway/application-context.ts:2,5` gateway 层 `new ClaudeCodeWorker()` 知道具体 worker 实现。

**约束**：
- `AGENTS.md`、`docs/standards/development.md`、`docs/standards/module-boundaries.md` 是硬合同。
- case JSON shape 必须保持可读，旧 case 仍可加载。
- HTTP response shape 和 `/api/knowledge/*` 行为必须兼容。
- 默认测试不联网、不花钱、不依赖真实凭证。

**利益相关方**：产品运维人员（依赖审计日志）、AI coding agent（依赖模块边界）、人工开发者（依赖文档与代码一致）。

## Goals / Non-Goals

**Goals:**
- 让审核日志成为可信 audit 层：模型 CoT 不写入 case JSON，evidence 引用化去重，phase 列表与文档同步。
- 让 deep query planner 适配真实项目结构：module 候选驱动 artifact target，路径前缀按项目类型适配，anchor terms 语义化。
- 收敛根目录散落文件到所属模块，拆分超标文件，下沉 gateway 越界编排。
- 保持 case JSON、HTTP response、knowledge artifact、public API 兼容。

**Non-Goals:**
- 不重写 deep query planner 的整体架构（只调整推断逻辑与路径适配）。
- 不重写 UI 渲染逻辑（只按页面区块拆分文件，HTML 字符串输出不变）。
- 不更换模型 provider 厂商（只迁移 `src/model.ts` 到 `src/providers/model/`）。
- 不优化 retrieval 排序算法（已在 `harden-runtime-retrieval-grounding` 与 `optimize-local-rag-pipeline` 处理）。
- 不在本 change 中处理所有 20 个超标文件，只优先处理 top 5（`ui.ts`、`knowledge/quality.ts`、`onboarding/service.ts`、`event-recorder.ts`、`setup-ui.ts`），其余登记为后续债务。

## Decisions

### Decision 1: 日志 redaction 统一为 "parsed 优先 + raw 截断脱敏"

**选择**：对所有存模型原始输出的 phase（`modelPreflightResult`、`modelReviewResult`、`raw_output`）统一施加 `redactProviderErrorMessage(raw).slice(0, 2000)`，并保留 `parsed` 字段作为权威决策记录。

**备选**：
- 完全不存 raw：审计无法回溯模型异常，排障困难。
- 存完整 raw：CoT 泄漏，case 文件膨胀（当前状态）。
- 只存 raw 不存 parsed：当前 `modelPreflightResult` 已存 parsed，但 raw 未脱敏。

**理由**：`parsed` 是结构化决策结果，足以支撑审计；`raw` 截断脱敏后仅用于异常排障，符合 `safe-worker-failure-presentation` 的 "bounded redacted troubleshooting data" 原则。

### Decision 2: evidence 存储改为 "首次完整 + 后续 ID 引用"

**选择**：在 `event-recorder.ts` 中，`knowledge_search_result` 保留完整 evidencePack（首次出现，作为 evidence 字典）；后续 phase（`knowledge_answer_selected`、`evidence_review_started`、`preflight_decision`、`diagnostic_request`、`user_reply`）只存 evidence ID 引用 + 关键决策字段。

**备选**：
- 全部 phase 都存完整 evidence：当前状态，case 文件 70-173KB。
- 全部 phase 都只存 ID：审计需要交叉引用才能还原上下文，可读性差。
- 单独建 evidence 字典表：改动 case JSON shape 过大。

**理由**：首次完整存储保证 evidence 字典可审计，后续 ID 引用避免重复；case JSON shape 只新增 `evidenceRefs` 字段，旧 case 的完整 evidence 仍可读。

### Decision 3: deep query planner 改为 "module 候选驱动 + 项目类型适配"

**选择**：
- `inferArtifactTargets` 改为以 `route.moduleCandidates` 为主要输入，建立 `module → artifactTargetFamily` 映射表（如 `marketing-theme → ['template', 'widget', 'config']`、`ai-companion → ['service', 'config']`）。`route.codeEscalationSignals` 作为补充。仅当 module 候选为空时回落到现有正则。
- `likelyPathsFor` 改为按项目类型适配的路径前缀表。项目类型由 knowledge workspace 元数据提供（默认 `generic`，可选 `symfony`、`node`、`vue` 等）。`symfony` 类型映射 `web/themes/**`、`app/config/**`、`src/Bundle/**`；`node` 类型映射 `src/**`、`lib/**`。
- `anchorTerms` 过滤 2-gram 噪声：只保留长度 ≥ 2 的有意义中文词或英文标识符，过滤 "销主""题中" 这类无语义滑窗结果。可选引入 `knowledge/glossary` 的术语表做白名单增强。

**备选**：
- 完全重写 deep query planner：风险过大，影响已有 `harden-knowledge-diagnosis-mvp` 与 `harden-runtime-retrieval-grounding` 的稳定路径。
- 保留硬编码但增加 EduSoho 专用分支：违反 `module-boundary-standards.md` "不要在 runtime 中增加策略分支"。
- 引入第三方分词器：增加依赖，违反 "默认测试不联网" 原则。

**理由**：module 候选已由 `knowledge-router` 产出，复用现有信号；项目类型适配通过元数据驱动，不引入新依赖；2-gram 过滤用本地规则即可。

### Decision 4: 根目录散落文件迁移保留 deprecation re-export

**选择**：将 `src/model.ts` → `src/providers/model/adapter.ts`、`src/preflight.ts` → `src/runtime/preflight-decision.ts`、`src/storage.ts` → `src/sessions/file-memory-store.ts`、`src/model-smoke-test.ts` → `src/providers/model/smoke-test.ts`。根目录原路径保留 `export * from './<new-path>.js'` 的 deprecation re-export 一个 minor 版本，并在 re-export 文件顶部加 `@deprecated` 注释。

**备选**：
- 直接删除根目录文件，一次性 break 所有 importer：违反 "保持 public API 兼容"。
- 永久保留 re-export facade：违反 "不得新增私有兼容 facade"。

**理由**：deprecation re-export 是 `module-boundary-standards.md` "当前债务处理方式" 允许的过渡方案；一个 minor 版本后删除，避免成为永久 facade。

### Decision 5: 超大文件拆分按职责边界，保持 public export

**选择**：
- `src/ui.ts` 拆为 `src/ui/main-screen.ts`、`src/ui/setup-drawer.ts`、`src/ui/components.ts`、`src/ui/styles.ts` 等，`src/ui/index.ts` 做 re-export 聚合。HTML 字符串输出不变。
- `src/knowledge/quality.ts` 拆为 `src/knowledge/quality/audit.ts`、`quality/report-io.ts`、`quality/gate.ts`、`quality/chunk-map.ts`，`quality/index.ts` re-export。
- `src/onboarding/service.ts` 拆为 `src/onboarding/draft-service.ts`、`review-service.ts`、`run-service.ts`、`secrets-service.ts`，`service.ts` 做窄组合入口。
- `src/runtime/event-recorder.ts` 拆为 `src/runtime/event-recorder/conversation.ts`、`preflight.ts`、`knowledge.ts`、`review.ts`、`curator.ts`、`worker.ts`，`event-recorder/index.ts` 聚合 `CaseRuntimeEventRecorder`。

**备选**：
- 不拆分，只登记债务：违反 300 行硬规则，债务继续加深。
- 按行数机械拆分：破坏职责边界。

**理由**：按职责拆分符合 `module-boundary-standards.md` 的拆分顺序（contract → 纯函数 → adapter → facade）；保持 public export 让 importer 无感知。

### Decision 6: gateway 越界编排下沉到 service 层

**选择**：
- 新增 `src/knowledge/health-service.ts` 封装 `buildKnowledgeHealthSummary` + `createConfiguredKnowledgeRetriever` 编排。
- `src/gateway/dto.ts` 的 `serializeSession` 改为调用 `health-service` 并序列化结果。
- `src/gateway/routes/knowledge-routes.ts` 的 health/init/reindex handler 改为调用 `knowledge` 或 `settings` 的 service 方法。
- `src/gateway/application-context.ts` 改为通过依赖注入接收 `DiagnosticWorker` port 实例，不直接 `new ClaudeCodeWorker()`。

**备选**：
- 在 gateway 内部建私有 service：违反 "不得新增私有兼容 facade"。
- 不处理，登记为债务：gateway 继续越界。

**理由**：service 下沉符合 `development-standards.md` Module Ownership Map；依赖注入让 gateway 只知道 port 不知道具体实现。

## Risks / Trade-offs

- **[Risk] evidence 引用化导致审计上下文断裂** → Mitigation: `knowledge_search_result` 始终保留完整 evidencePack 作为字典；日志渲染器（`observability/log-blocks.ts`）按 ID 引用回查字典。
- **[Risk] deep query planner module 映射表不完整，覆盖不全** → Mitigation: 保留现有正则作为 fallback；module 候选为空时回落到通用 artifactTargets；新增 contract test 覆盖已知 module。
- **[Risk] 项目类型元数据缺失导致 likelyPaths 退化** → Mitigation: 默认 `generic` 类型使用现有 `src/**` 前缀；knowledge workspace 元数据可选字段，缺失不阻断。
- **[Risk] 根目录 re-export 成为永久 facade** → Mitigation: 在 re-export 文件顶部加 `@deprecated` 注释和删除版本号；一个 minor 版本后强制删除并更新 importer。
- **[Risk] 超大文件拆分引入回归** → Mitigation: 保持 public export 不变；拆分后运行 `pnpm test` 验证 contract；按 `verification-before-completion` skill 要求逐文件验证。
- **[Risk] phase 列表同步后旧 case 的未登记 phase 变成孤儿** → Mitigation: 旧 case JSON 保持可读；日志渲染器对未知 phase 做 fallback 渲染；文档注明 "已归档 phase" 列表。
- **[Trade-off] anchor terms 过滤可能丢失少量有效 2-gram** → 接受：2-gram 噪声的危害远大于少量有效 2-gram 的收益；glossary 白名单可补回关键术语。
- **[Trade-off] 模块拆分短期增加文件数量，增加导航成本** → 接受：长期可维护性优于文件数量；IDE 跳转和 grep 仍可用。

## Migration Plan

**Phase 1 — 审核日志卫生（低风险，先做）**：
1. 在 `event-recorder.ts` 为 `modelPreflightResult`、`raw_output` 补 redaction + slice。
2. 重构 evidence 存储为 "首次完整 + 后续 ID 引用"。
3. 补齐知识直答路径的 `preflight_decision` phase。
4. 按 persona 脱敏 `user_reply` 中的内部 knowledge 路径。
5. 同步 `development-standards.md` 的 phase 列表。
6. 运行 `pnpm test` 验证日志 contract test。

**Phase 2 — Deep Query Planner 适配（中风险，独立做）**：
1. 建立 `module → artifactTargetFamily` 映射表，`inferArtifactTargets` 改为 module 驱动。
2. 建立项目类型 → 路径前缀表，`likelyPathsFor` 改为类型适配。
3. 过滤 `anchorTerms` 的 2-gram 噪声。
4. 新增 deep query planner contract test 覆盖 EduSoho/Symfony 场景。
5. 运行 `pnpm test` 验证。

**Phase 3 — 模块边界债务清理（高风险，分步做）**：
1. 迁移根目录散落文件到所属模块，保留 deprecation re-export。
2. 拆分 top 5 超标文件（`ui.ts`、`knowledge/quality.ts`、`onboarding/service.ts`、`event-recorder.ts`、`setup-ui.ts`）。
3. 下沉 gateway 越界编排到 service 层。
4. 更新所有 importer，运行 `pnpm typecheck && pnpm test`。
5. 一个 minor 版本后删除 deprecation re-export。

**Rollback 策略**：
- 每个 Phase 独立提交，可单独 revert。
- Phase 1 和 Phase 2 不改变 public API，revert 无风险。
- Phase 3 的根目录迁移保留 re-export 期间可 revert；删除 re-export 后 revert 需要恢复迁移文件。

**验证要求**：
- 每个 Phase 完成后运行 `pnpm lint && pnpm typecheck && pnpm build && pnpm test`。
- 新增 contract test 覆盖：日志 redaction、evidence 引用化、phase 同步、deep query planner 适配、模块边界迁移。
- 更新 `docs/standards/development.md`、`docs/standards/module-boundaries.md`、`docs/architecture/overview.md`。

## Open Questions

- 项目类型元数据应该放在 `config.json`、knowledge workspace manifest，还是 case 上下文？倾向 knowledge workspace manifest，因为路径适配与知识库绑定。
- `module → artifactTargetFamily` 映射表应该放在 `src/agents/registry.json`、`src/knowledge/taxonomy`，还是 `src/runtime/deep-query-planner.ts` 内？倾向 `src/runtime/deep-query-planner.ts` 内的常量表，因为这是 runtime 编排细节，不是 Agent 配置或知识资产。
- `event-recorder.ts` 拆分后 `CaseRuntimeEventRecorder` 类是否仍作为单一入口？倾向保留单一类，按 mixin 或 partial class 模式组合，避免 importer 感知拆分。
- 是否需要在 Phase 1 同步处理 `experience_agent_result`、`case_curator_*` 等未登记 phase 的文档化？倾向是，一次性同步完整列表。
