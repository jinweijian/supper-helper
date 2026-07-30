## 1. 历史案例配置与 MCP capability

- [ ] 1.1 先写旧配置兼容、historicalCaseSources round-trip 和非法引用拒绝测试
- [ ] 1.2 为 MCP server 增加可选 historical_case/redmine capability 合同
- [ ] 1.3 为 workspace 增加可选 serverId、projectAliases 和私有备注策略
- [ ] 1.4 在配置加载边界校验 read-only、tool allowlist、server 引用和项目列表
- [ ] 1.5 保证 onboarding 配置提交保留 historicalCaseSources
- [ ] 1.6 运行配置、onboarding 和类型专项验证

## 2. Redmine REST 只读适配

- [ ] 2.1 先写 API Key header、固定 base URL、GET-only 和安全错误失败测试
- [ ] 2.2 定义 Redmine 原始 issue/search/pagination Zod 协议
- [ ] 2.3 实现带超时和安全错误码的 GET-only Redmine client
- [ ] 2.4 先写 rest_search 项目二次校验和 bounded paging 测试
- [ ] 2.5 实现启动时固定的 rest_search backend
- [ ] 2.6 先写 issues_scan 的 status_id=*、历史窗口、分页和缓存测试
- [ ] 2.7 实现启动时固定的 issues_scan backend
- [ ] 2.8 验证 backend 请求期间不会静默切换或扩大范围

## 3. Redmine 隐私与结构化预算

- [ ] 3.1 先写人员匿名、私有备注默认删除和附件元数据测试
- [ ] 3.2 实现候选与详情字段白名单归一化
- [ ] 3.3 实现进程 salt 下稳定的匿名人员 ID
- [ ] 3.4 实现服务端与 workspace 双重私有备注门禁
- [ ] 3.5 先写 48,000 字符内保持合法 JSON 和完整 evidence block 的失败测试
- [ ] 3.6 实现按完整 journal/attachment/字段收缩的结构化 bounding
- [ ] 3.7 验证输出不含姓名、邮箱、用户名、网络标识、下载 URL 或凭证

## 4. Redmine MCP Server 与 transports

- [ ] 4.1 先写两个且仅两个 MCP 工具的 schema/输出合同测试
- [ ] 4.2 实现 searchId 候选授权、TTL 和唯一候选集合
- [ ] 4.3 实现 redmine_search_issues 并强制最大 10 条
- [ ] 4.4 实现 redmine_get_issue_case_details 并强制 searchId 和最大 3 条
- [ ] 4.5 先写 stdio 与 HTTP tool schema 一致性测试
- [ ] 4.6 实现 stdio transport
- [ ] 4.7 实现带独立 Bearer 认证的 Streamable HTTP transport
- [ ] 4.8 先写缺 URL、API Key、项目映射和非法预算的配置失败测试
- [ ] 4.9 实现 Redmine MCP 启动配置与薄 main.ts
- [ ] 4.10 增加 super-helper-redmine-mcp package bin 并验证构建产物

## 5. 主应用 historical-case MCP 证据边界

- [ ] 5.1 先写 legacy 20K 归一化不变和 historical-case 48K JSON 完整性测试
- [ ] 5.2 根据显式 MCP capability 选择 schema-aware historical-case normalizer
- [ ] 5.3 先写 workspace/server/project allowlist 与 search 状态映射测试
- [ ] 5.4 实现 HistoricalCaseEvidenceService.search
- [ ] 5.5 先写同一 searchId、最多 3 条详情和 evidence provenance 测试
- [ ] 5.6 实现 HistoricalCaseEvidenceService.getDetails
- [ ] 5.7 验证 timeout、failed、no_hit 不互相转换且 historical-case 不能直接生成最终答复

## 6. Product Agents 与严格模型服务

- [ ] 6.1 先写 Planner 有效、非法、超时、未知项目和 fallback schema 测试
- [ ] 6.2 创建 Evidence Source Planner Agent 配置和模型 service
- [ ] 6.3 先写候选重排只能选择搜索结果内最多 3 个 ID 的测试
- [ ] 6.4 创建 Historical Case Analyzer Agent 配置并实现 reranker service
- [ ] 6.5 先写 Analyzer evidence ID、冲突和只读计划 schema 测试
- [ ] 6.6 实现 Historical Case Analyzer service
- [ ] 6.7 先写 Current Evidence Assessor 的 worker_needed/worker_not_needed 测试
- [ ] 6.8 创建 Current Evidence Assessor Agent 配置和 service
- [ ] 6.9 先写 Verifier 禁止新增事实和未知 evidence ID 测试
- [ ] 6.10 创建 Historical Case Verifier Agent 配置和 service
- [ ] 6.11 补齐 AgentStage、registry、README 和公共 Agent 列表

## 7. 无提前呈现的证据 collectors

- [ ] 7.1 先写 Knowledge collect 不修改共享 request、不创建 Run/回复的测试
- [ ] 7.2 从 KnowledgeTurnService 拆出 evidence-only collect 并保持 answer 行为
- [ ] 7.3 先写 Experience collect 不短路、不创建 Run/回复的测试
- [ ] 7.4 从 ExperienceTurnService 拆出 evidence-only collect 并保持 fast answer 行为
- [ ] 7.5 先写 Worker ephemeral request、sanitized persisted request 和单次执行测试
- [ ] 7.6 从 WorkerDiagnosisService 拆出 collectEvidence 并保持普通 deep-query follow-up 行为
- [ ] 7.7 在 Worker 派发前确定性拒绝写操作或不完整的匹配/反匹配计划

## 8. 并行来源采集

- [ ] 8.1 用 deferred Promise 先写 Knowledge 与完整 Redmine 分支同时启动的测试
- [ ] 8.2 实现 Promise.allSettled collection barrier
- [ ] 8.3 先写 Redmine search→rerank→details 严格串行和 10→3 预算测试
- [ ] 8.4 实现 Redmine branch 与同一 searchId 详情调用
- [ ] 8.5 先写单来源 timeout/failed/no_hit/not_planned 的组合测试
- [ ] 8.6 实现独立来源状态与 sourceGaps 聚合

## 9. 同因确定性门禁与结果构建

- [ ] 9.1 先写当前 workspace/log + 本轮 Redmine 双侧证据通过测试
- [ ] 9.2 先写仅 user claim、仅历史、来源失败和非当前 envelope 降级测试
- [ ] 9.3 先写 Worker 反证和 Knowledge 冲突阻止同因测试
- [ ] 9.4 实现 historical-case gate 与稳定 Review blockers
- [ ] 9.5 实现只使用已引用 evidence 的 DiagnosticResult builder
- [ ] 9.6 扩展 ReviewPresentation context 接收 upstream blockers
- [ ] 9.7 验证降级时保留有证据的初步判断但不表达最终同因

## 10. Case Investigation Runtime 编排

- [ ] 10.1 先写 Planner fast_answer 保持旧快速路径的测试
- [ ] 10.2 先写案例路径中 Experience/Knowledge 不早停和单次呈现测试
- [ ] 10.3 实现 CaseInvestigationTurnService 的 Planner、collector、Analyzer、Assessor、Verifier 编排
- [ ] 10.4 按 Assessor 结果接入最多一次 Worker collect
- [ ] 10.5 接入 gate、Result、一次 Review/Presentation 和 completePresentedTurn
- [ ] 10.6 在 Preflight 后、Experience 早停前把 collaborator 接入 DiagnosticRuntime
- [ ] 10.7 保持 DiagnosticRuntime 不超过 300 行并抽出通用 MCP 完成 helper
- [ ] 10.8 验证同步 200 与 async 202 API 顶层 shape 不变

## 11. 安全可观测性与 Dashboard 进度

- [ ] 11.1 先写案例调查 Agent identity 和 MCP/Worker actor 区分测试
- [ ] 11.2 新增 case-investigation event recorder 与四个 Agent identities
- [ ] 11.3 先写事件 detail 禁止 query、body、人员、URL、token、reason 和 raw error 的测试
- [ ] 11.4 在各编排阶段记录状态、耗时、数量和 evidence ID 白名单事件
- [ ] 11.5 为 observability log blocks 增加安全中文阶段标签
- [ ] 11.6 先写 Dashboard 新 phase 到进度标题的映射测试
- [ ] 11.7 增加来源规划、并行采集、案例分析、当前验证和同因核验进度
- [ ] 11.8 更新 development.md 事件列表并让 runtime-hardening 扫描全部 recorder 文件

## 12. 边界、公共安全与运维文档

- [ ] 12.1 先写 src/mcp-servers 禁止导入 runtime/gateway/worker/session/knowledge 的边界测试
- [ ] 12.2 更新 module-boundaries、architecture overview 和 agents 架构文档
- [ ] 12.3 先写 session/log DTO 不含 investigation internals 或 Redmine 原文的测试
- [ ] 12.4 确保调查状态仅 turn-local 且持久化 request 经过清洗
- [ ] 12.5 创建 Redmine MCP 配置、部署、烟测、灰度和回滚 runbook
- [ ] 12.6 创建仅显式运行且只读输出的真实 Redmine 验收脚本
- [ ] 12.7 确认默认 pnpm test 不读取真实 Redmine URL 或凭证

## 13. 全量验证与收尾

- [ ] 13.1 运行 pnpm lint 并修复文档/术语问题
- [ ] 13.2 运行 pnpm typecheck 并修复 TypeScript/Vue 类型问题
- [ ] 13.3 运行 pnpm build 并确认两个 bin 构建产物
- [ ] 13.4 运行 pnpm test 并修复全量 Node 回归
- [ ] 13.5 运行 pnpm test:web 并修复 Dashboard 回归
- [ ] 13.6 运行所有 redmine、historical-case、case-investigation 离线专项测试
- [ ] 13.7 扫描生产代码，确认只注册两个 Redmine 读工具且无 create/update/delete
- [ ] 13.8 对照设计、规格和实施计划完成最终代码审查
