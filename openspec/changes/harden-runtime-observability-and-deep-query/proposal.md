## Why

对 `src/` 代码与两条代表性服务会话（`case_aae61669` 代码升级路径、`case_816ea182` 知识直答路径）审核日志的联合审查发现三类系统性问题：

1. **审核日志卫生失控**：模型原始 chain-of-thought 通过 `event-recorder.ts` 的 `modelPreflightResult.detail.raw` 完整写入 case JSON，无 redaction、无 slice；同一批 evidence 在单条 case 中重复存储 4 次，导致知识直答 case 70KB、代码升级 case 173KB；`development-standards.md` 列出 16 个标准 phase，但实现已扩展到 40+ 个未登记 phase，文档与代码严重脱节。
2. **Deep Query Planner 与真实项目结构不匹配**：`deep-query-planner.ts` 的 `likelyPathsFor` 硬编码 `src/**/*service*` 等后端路径假设，`inferArtifactTargets` 硬编码 scheduler/queue/payment 等通用后端概念，对 EduSoho 这类 Symfony 项目（模板在 `web/themes/`、前端在 `vue3/`、配置在 `app/config/`）完全误导；anchor terms 直接复用 `route.keywords` 的 2-gram 滑窗结果（"销主""题中""中关"），作为 constraints 传给 Claude Code 干扰判断。
3. **模块边界债务积累**：`src/model.ts`、`src/preflight.ts`、`src/storage.ts`、`src/model-smoke-test.ts` 等实现散落根目录违反 "禁止根级私有兼容入口"；`src/ui.ts` 2990 行、`src/knowledge/quality.ts` 855 行、`src/onboarding/service.ts` 806 行、`src/runtime/event-recorder.ts` 683 行等超标文件未拆分；`src/gateway/dto.ts` 与 `src/gateway/routes/knowledge-routes.ts` 在 DTO/route 层编排 retrieval 与 knowledge health 业务。

这些问题现在必须处理，因为：审核日志是产品合同约定的 audit 层，CoT 泄漏和 evidence 重复已经影响 case 文件可读性和安全性；deep query planner 误导直接导致代码升级路径诊断准确率下降；模块边界债务若继续加深，将违反 `AGENTS.md` 的硬规则。

## What Changes

### 审核日志卫生

- 为 `event-recorder.ts` 的 `modelPreflightResult`、`modelReviewResult`、`raw_output` 等存模型原始输出的 phase 统一施加 `redactProviderErrorMessage + slice(0, 2000)`，剥离 chain-of-thought。
- 将 `preflight_decision`、`diagnostic_request`、`evidence_review_started` 等 phase 的 detail 从存完整 `DiagnosticRequest`（含 evidence 数组）改为存 evidence ID 引用 + 关键决策字段，避免重复存储。
- 补齐知识直答路径缺失的 `preflight_decision` phase，消除审计断链。
- 按 persona 脱敏 `user_reply` 中的内部 knowledge 文件路径，对 `operations` persona 只保留业务可读名称。
- 同步 `development-standards.md` 的 established phases 列表与 `event-recorder.ts` 实际定义的 40+ phase，建立 phase 登记合同。

### Deep Query Planner 适配

- 将 `inferArtifactTargets` 从硬编码正则改为由 `knowledge-router` 的 `moduleCandidates` 驱动，module 候选映射到对应 artifact target family。
- 将 `likelyPathsFor` 从硬编码 `src/**` 前缀改为按项目类型（Symfony/Node/Vue 等）适配的路径前缀表，或由 knowledge workspace 元数据提供路径根。
- 过滤 `anchorTerms` 的 2-gram 噪声，只保留有意义关键词；不再把无语义 2-gram 拼入 `DiagnosticRequest.constraints`。
- **BREAKING**：`DiagnosticRequest.context.deepQuery.likelyPaths` 与 `anchorTerms` 的 shape 调整为语义化结构，旧 case JSON 可读但不再作为 runtime 输入。

### 模块边界债务清理

- 将 `src/model.ts` 迁入 `src/providers/model/`，`src/preflight.ts` 迁入 `src/runtime/`，`src/storage.ts` 迁入 `src/sessions/`，`src/model-smoke-test.ts` 迁入 `src/providers/model/`，保留薄 re-export 兼容入口并登记迁移。
- 拆分 `src/ui.ts`（2990 行）为按页面区块的 `src/ui/*.ts` 模板模块；拆分 `src/knowledge/quality.ts` 为 `quality/audit.ts`、`quality/report-io.ts`、`quality/gate.ts`、`quality/chunk-map.ts`；拆分 `src/onboarding/service.ts` 为 draft/review/run/secrets 子模块；拆分 `src/runtime/event-recorder.ts` 按相位分组。
- 将 `src/gateway/dto.ts` 与 `src/gateway/routes/knowledge-routes.ts` 中的 knowledge health / retriever 编排下沉到 `knowledge` 或 `settings` service，route/DTO 只调 service 并序列化。
- **BREAKING**：移除根目录 `src/model.ts`、`src/preflight.ts`、`src/storage.ts`、`src/model-smoke-test.ts` 的直接 import 路径，改为从所属模块导入；保留 deprecation re-export 一个 minor 版本。

## Capabilities

### New Capabilities

- `runtime-observability-hygiene`: 定义 runtime 日志的 redaction、evidence 引用化、phase 登记合同，覆盖模型 CoT 剥离、evidence 去重、phase 同步、persona 脱敏。
- `deep-query-planner-adaptation`: 定义 deep query planner 的 module 驱动 artifact target 推断、项目类型适配 likelyPaths、anchor terms 噪声过滤合同。
- `module-boundary-debt-cleanup`: 定义根目录散落文件的迁移、超大文件拆分、gateway 越界编排下沉的过渡方案与兼容要求。

### Modified Capabilities

- `safe-worker-failure-presentation`: 扩展 redaction 要求覆盖 `modelPreflightResult.detail.raw`，与 `modelReviewResult` 对齐，并约束 `raw_output` 的 stdout redaction。
- `knowledge-diagnosis-hardening`: 强化 deep query planner 的 module 候选驱动、路径适配和 anchor terms 语义化要求，替代硬编码正则与 2-gram 滑窗。

## Impact

- **主要影响**：`src/runtime/event-recorder.ts`、`src/runtime/deep-query-planner.ts`、`src/runtime/query-correction.ts`、`src/runtime/knowledge-diagnosis.ts`、`src/runtime/worker-diagnosis.ts`、`src/observability/log-blocks.ts`、`src/observability/worker-trace.ts`、`docs/standards/development.md`。
- **迁移影响**：`src/model.ts` → `src/providers/model/`、`src/preflight.ts` → `src/runtime/`、`src/storage.ts` → `src/sessions/`、`src/model-smoke-test.ts` → `src/providers/model/`；更新所有 importer。
- **拆分影响**：`src/ui.ts`、`src/knowledge/quality.ts`、`src/onboarding/service.ts`、`src/runtime/event-recorder.ts`、`src/setup-ui.ts` 等超标文件；保持 public export 与 UI HTML 字符串输出不变。
- **gateway 影响**：`src/gateway/dto.ts`、`src/gateway/routes/knowledge-routes.ts`、`src/gateway/application-context.ts`；保持 HTTP response shape 和 `/api/knowledge/*` 行为兼容。
- **持久化影响**：case JSON shape 保持可读，旧 case 的 `deepQuery.likelyPaths` 与 `anchorTerms` 旧 shape 仍可读但 runtime 不再作为输入；新 case 采用语义化结构。
- **测试影响**：新增日志 redaction、evidence 引用化、phase 同步、deep query planner 适配、模块边界迁移的 contract tests；更新现有 runtime/observability/gateway tests。
- **文档影响**：同步 `docs/standards/development.md` 的 phase 列表、`docs/standards/module-boundaries.md` 的根目录收敛规则、`docs/architecture/overview.md` 的 deep query planner 章节。
