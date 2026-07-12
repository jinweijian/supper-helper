## 1. 审核日志卫生 — redaction 统一

- [x] 1.1 在 `src/runtime/event-recorder.ts` 的 `modelPreflightResult` 方法（line 156-168）为 `detail.raw` 补 `redactProviderErrorMessage(raw).slice(0, 2000)`，与 `modelReviewResult` 对齐
- [x] 1.2 在 `src/runtime/event-recorder.ts` 的 `workerTrace` 方法（line 643-672）为 `detail.stdout` 补 `redactProviderErrorMessage` 脱敏
- [x] 1.3 新增 contract test：`model_preflight_result` 的 `detail.raw` 不含完整 chain-of-thought 文本
- [x] 1.4 新增 contract test：`raw_output` 的 `detail.stdout` 经过 redaction
- [x] 1.5 运行 `pnpm typecheck && pnpm test` 验证

## 2. 审核日志卫生 — evidence 引用化

- [x] 2.1 在 `src/runtime/event-recorder.ts` 的 `knowledgeAnswerSelected`、`evidenceReviewStarted`、`preflightDispatch`、`diagnosticRequestCreated`、`finalReplyCreated` 方法中，将完整 evidence 数组替换为 `evidenceIds: string[]` + 关键决策字段
- [x] 2.2 保留 `knowledgeSearchResult`（line 440-449）存完整 `KnowledgeEvidencePack` 作为 evidence 字典
- [x] 2.3 在 `src/observability/log-blocks.ts` 增加按 evidence ID 回查字典的渲染逻辑
- [x] 2.4 新增 contract test：同一 case 中 evidence 完整对象只出现一次（在 `knowledge_search_result`）
- [x] 2.5 新增 contract test：旧 case JSON 含完整 evidence 字段仍可读，不报错
- [x] 2.6 运行 `pnpm typecheck && pnpm test` 验证

## 3. 审核日志卫生 — 补齐 preflight_decision phase

- [x] 3.1 在 `src/runtime/event-recorder.ts` 新增 `preflightKnowledgeAnswer` 方法，记录 `decision: "knowledge_answer"` 的 `preflight_decision` phase
- [x] 3.2 在 `src/runtime/knowledge-diagnosis.ts` 或 `knowledge-acceptance.ts` 的知识直答路径中调用 `preflightKnowledgeAnswer`
- [x] 3.3 新增 contract test：知识直答路径 case 日志包含 `preflight_decision` phase
- [x] 3.4 运行 `pnpm test` 验证

## 4. 审核日志卫生 — persona 脱敏

- [x] 4.1 在 `src/runtime/presenter.ts` 或 `review-presentation.ts` 增加按 persona 脱敏内部 knowledge 路径的逻辑：`operations` persona 只保留业务可读名称
- [x] 4.2 新增 contract test：`operations` persona 的 `user_reply` 不含 `knowledge/_sources/whitepapers/` 路径
- [x] 4.3 新增 contract test：`developer` persona 的 `user_reply` 可保留技术路径
- [x] 4.4 运行 `pnpm test` 验证

## 5. 审核日志卫生 — phase 文档同步

- [x] 5.1 在 `docs/standards/development.md` 的 "Preserve established phases" 列表补齐 `event-recorder.ts` 实际定义的 40+ phase（`experience_*`、`knowledge_router_*`、`knowledge_search_*`、`evidence_judge_*`、`deep_query_*`、`case_review_*`、`case_curator_*`、`knowledge_answer_selected`、`code_escalation_requested`、`evidence_validation_result`、`model_preflight_failed/overridden_by_local_dispatch`、`model_review_failed`、`follow_up_diagnostic_requested`、`resolution_confirmed`）
- [x] 5.2 在 `src/observability/log-blocks.ts` 为未知 phase 增加 fallback 渲染
- [x] 5.3 新增 contract test：`event-recorder.ts` 中每个 phase 都在 `development-standards.md` 文档列表中
- [x] 5.4 运行 `pnpm lint` 验证文档

## 6. Deep Query Planner — module 驱动 artifact targets

- [x] 6.1 在 `src/runtime/deep-query-planner.ts` 建立 `MODULE_TO_ARTIFACT_TARGETS` 映射表常量（如 `marketing-theme → ['template','widget','config']`、`ai-companion → ['service','config']`）
- [x] 6.2 重构 `inferArtifactTargets`（line 126-140）改为以 `route.moduleCandidates` 为主要输入，`route.codeEscalationSignals` 作为补充，正则作为 fallback
- [x] 6.3 新增 contract test：`moduleCandidates=['marketing-theme']` 产生 `['template','widget','config']` 而非 `['service']`
- [x] 6.4 新增 contract test：`moduleCandidates=[]` 回落到现有正则逻辑
- [x] 6.5 运行 `pnpm typecheck && pnpm test` 验证

## 7. Deep Query Planner — 项目类型适配 likelyPaths

- [x] 7.1 在 knowledge workspace manifest 或 config 增加 `projectType` 元数据字段（默认 `generic`，可选 `symfony`、`node`、`vue`）
- [x] 7.2 在 `src/runtime/deep-query-planner.ts` 建立 `PROJECT_TYPE_PATH_PATTERNS` 映射表（`symfony → {template: ['web/themes/**/*.twig', 'app/config/**/*.yml'], service: ['src/Bundle/**/*.php']}` 等）
- [x] 7.3 重构 `likelyPathsFor`（line 142-154）接受 `projectType` 参数，按类型查表
- [x] 7.4 修改 `planDeepQuery` 传入 projectType 元数据
- [x] 7.5 新增 contract test：`projectType='symfony'` 时 `likelyPathsFor(['template'])` 返回 `web/themes/**/*.twig` 而非 `src/**/*template*`
- [x] 7.6 新增 contract test：`projectType` 缺失时默认 `generic`，返回现有 `src/**` 模式
- [x] 7.7 运行 `pnpm typecheck && pnpm test` 验证

## 8. Deep Query Planner — anchor terms 噪声过滤

- [x] 8.1 在 `src/runtime/deep-query-planner.ts` 增加 `filterMeaningfulAnchorTerms` 函数，过滤 2-gram 滑窗噪声（保留长度 ≥ 2 的有意义中文词或英文标识符）
- [x] 8.2 可选：从 `src/knowledge/glossary` 读取术语白名单增强过滤
- [x] 8.3 修改 `planDeepQuery`（line 36-41）对 `anchorTerms` 施加过滤
- [x] 8.4 修改 `attachDeepQueryContext`（line 121）使 constraints 的 "优先使用 anchor terms" 行只列过滤后语义词
- [x] 8.5 新增 contract test：`route.keywords=['营销','销主','主题','题中']` 时 `anchorTerms` 排除 "销主""题中"
- [x] 8.6 新增 contract test：glossary 白名单术语即使符合 2-gram 特征也被保留
- [x] 8.7 运行 `pnpm typecheck && pnpm test` 验证

## 9. 模块边界 — 根目录散落文件迁移

- [x] 9.1 创建 `src/providers/model/` 目录，将 `src/model.ts` 内容迁移到 `src/providers/model/adapter.ts`
- [x] 9.2 `src/model.ts` 改为 `export * from './providers/model/adapter.js'` 并加 `@deprecated` 注释
- [x] 9.3 将 `src/model-smoke-test.ts` 迁移到 `src/providers/model/smoke-test.ts`，原路径留 deprecation re-export
- [x] 9.4 创建 `src/runtime/preflight-decision.ts`，将 `src/preflight.ts` 内容迁移，原路径留 deprecation re-export
- [x] 9.5 创建 `src/sessions/file-memory-store.ts`，将 `src/storage.ts` 的 `FileMemoryStore` 实现迁移，`src/sessions/file-case-repository.ts` 改为从新路径 import
- [x] 9.6 `src/storage.ts` 改为 deprecation re-export
- [x] 9.7 更新所有 importer 从新路径导入（`grep -r "from '../model.js'" src/` 等逐个更新）
- [x] 9.8 新增 contract test：从新路径 `src/providers/model/adapter.js` 和旧路径 `src/model.js` 都能 import 到相同 symbol
- [x] 9.9 运行 `pnpm typecheck && pnpm build && pnpm test` 验证

## 10. 模块边界 — 超大文件拆分

- [x] 10.1 拆分 `src/ui.ts`（2990 行）为 `src/ui/main-screen.ts`、`setup-drawer.ts`、`components.ts`、`styles.ts`，`src/ui/index.ts` 做 re-export 聚合，保持 HTML 字符串输出不变
- [x] 10.2 拆分 `src/setup-ui.ts`（642 行）按职责归入 `src/ui/setup-*.ts` 子模块
- [x] 10.3 拆分 `src/knowledge/quality.ts`（855 行）为 `src/knowledge/quality/{audit,report-io,gate,chunk-map}.ts`，`quality/index.ts` re-export
- [x] 10.4 拆分 `src/onboarding/service.ts`（806 行）为 `src/onboarding/{draft-service,review-service,run-service,secrets-service}.ts`，`service.ts` 做窄组合入口
- [x] 10.5 拆分 `src/runtime/event-recorder.ts`（683 行）为 `src/runtime/event-recorder/{conversation,preflight,knowledge,review,curator,worker}.ts`，`event-recorder/index.ts` 聚合 `CaseRuntimeEventRecorder`
- [x] 10.6 每个拆分完成后运行 `pnpm typecheck && pnpm test` 验证 public export 不变
- [x] 10.7 新增 contract test：拆分后 public export 与拆分前 import 兼容

## 11. 模块边界 — gateway 越界编排下沉

- [x] 11.1 创建 `src/knowledge/health-service.ts`，封装 `buildKnowledgeHealthSummary` + `createConfiguredKnowledgeRetriever` 编排
- [x] 11.2 修改 `src/gateway/dto.ts`（line 5-8, 79-94）的 `serializeSession` 改为调用 `health-service`，移除对 `knowledge/index.js` 和 `retrieval/configured-search.js` 的直接 import
- [x] 11.3 修改 `src/gateway/routes/knowledge-routes.ts`（line 3-9, 30-88）的 health/init/reindex handler 改为调用 `knowledge` 或 `settings` service 方法
- [x] 11.4 修改 `src/gateway/application-context.ts`（line 2, 5）改为通过依赖注入接收 `DiagnosticWorker` port 实例，不直接 `new ClaudeCodeWorker()`
- [x] 11.5 新增 contract test：`src/gateway/` 不再 import `buildKnowledgeHealthSummary` 或 `createConfiguredKnowledgeRetriever`
- [x] 11.6 新增 contract test：`/api/knowledge/health`、`/api/knowledge/bind`、`/api/knowledge/reindex` response shape 不变
- [x] 11.7 运行 `pnpm typecheck && pnpm test` 验证

## 12. 文档同步与最终验证

- [x] 12.1 更新 `docs/standards/development.md` 的 phase 列表（与 task 5.1 协同）
- [x] 12.2 更新 `docs/standards/module-boundaries.md` 的根目录收敛规则，注明 deprecation re-export 过渡期
- [x] 12.3 更新 `docs/architecture/overview.md` 的 deep query planner 章节，说明 module 驱动与项目类型适配
- [x] 12.4 更新 `AGENTS.md` 如有需要
- [x] 12.5 运行 `pnpm lint` 验证文档
- [x] 12.6 运行 `pnpm typecheck` 验证类型
- [x] 12.7 运行 `pnpm build` 验证构建
- [x] 12.8 运行 `pnpm test` 验证全部 contract test 通过
- [x] 12.9 在 change 目录新增 `implementation-notes.md` 记录实际实现与设计的偏差

## 13. 后续债务登记（本 change 不实施）

- [x] 13.1 在 `implementation-notes.md` 登记剩余 15 个超标文件（`knowledge/types.ts`、`evidence-judge.ts`、`repair.ts`、`extract.ts`、`publish.ts`、`case-curator.ts`、`runner.ts`、`vector-index.ts`、`slicer.ts`、`templates.ts`、`knowledge-acceptance.ts`、`ingest.ts`、`config.ts`、`frontmatter.ts`、`retrieval-evaluation.ts`）作为后续 OpenSpec change 输入
- [x] 13.2 登记一个 minor 版本后删除 deprecation re-export 的后续任务
- [x] 13.3 登记将 `src/observability/worker-trace.ts` 对 `providers/redaction.js` 的依赖下沉为中立 util 的后续任务
