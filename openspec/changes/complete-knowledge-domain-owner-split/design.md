## Context

Knowledge quality/pipeline 与共享 types/config/domain 存在多个超过约 300 行且混合规则、I/O、mapping 的文件。现有 quality 子文件反向 re-export `audit.ts`，不能独立理解或测试。

## Goals / Non-Goals

**Goals:**

- 真实拆分 Knowledge rules、I/O、artifacts、contracts 和 orchestration。
- 保持知识 artifact、CLI、Provider/Retrieval 边界和默认离线行为。
- 用端到端 pipeline 与结构 gate 防止假完成。

**Non-Goals:**

- 不改变 chunk、manifest、quality report 或 published knowledge schema。
- 不顺带调整检索排序阈值。

## Decisions

1. Quality 拆为 source/slice/chunk rules、aggregation、gate、report IO、chunk quality map；audit orchestrator 只加载输入和组合纯规则。
2. Extract/slice/repair/publish/vector/frontmatter 分别拆出 contracts、pure transforms、artifact IO、service orchestration；CLI 只调用 service。
3. `knowledge/types.ts`、`domain.ts`、`config.ts` 按 capability 拆成稳定 contract 文件，原 owner 仅做明确公共聚合；不得把实现移入聚合文件。
4. 生产 TS/Vue 实现文件上限 300 行；纯类型聚合、生成文件、fixture 例外必须在实现说明列出原因、owner 和生产引用。
5. 结构测试解析 imports/exports，拒绝 marker、未被生产引用 owner、反向 re-export giant file；端到端 acceptance 必须走真实文件系统与 production CLI/service。

### Reviewed oversized implementation exceptions

本 change 完成后，Knowledge、Domain、Config 和 Vue 实现 owner 均不超过 300 行。全仓仍保留以下既有、跨 change 的明确例外；结构 gate 只允许这份精确清单，新增或增长必须另行设计评审：

| 文件 | owner / 原因 | 验收证据 |
| --- | --- | --- |
| `src/runtime/evidence-judge.ts` | Evidence Judge 的确定性评分与 blocker 决策矩阵；本 change 不调整检索阈值，机械拆分会扩大语义漂移风险 | knowledge judge、grounding、runtime suites |
| `src/runtime/presenter.ts` | 冻结 claim 的确定性多 persona 渲染与安全 fallback；与 Presentation 完整回复校验共同演进 | presentation integrity、runtime suites |
| `src/runtime/case-curator.ts` | solved-case 草稿的证据过滤与安全分类单一 owner | case curator acceptance |
| `src/onboarding/runner.ts` | 持久化 stage state machine；阶段转换、失败恢复和 progress 发布必须保持一个原子状态机 | onboarding retry/recovery/full HTTP+SSE suites |
| `src/runtime/knowledge-diagnosis.ts` | Runtime 内 Knowledge/RAG 判定组合，不属于 Knowledge artifact domain | runtime knowledge diagnosis suites |
| `src/runtime/knowledge-acceptance.ts` | 独立 acceptance 场景执行器，不进入生产用户回合 | knowledge acceptance suite |
| `src/runtime/retrieval-evaluation.ts` | 离线 evaluation runner，不进入生产检索请求 | retrieval evaluation suite |

`src/knowledge/templates.ts` 已拆为 catalog/examples/document templates；所有模板 owner 均低于 300 行。纯 contract 聚合器也已按 capability 拆分，不使用超长例外。

## Risks / Trade-offs

- [拆分破坏循环依赖] → 先提 leaf contracts/pure rules，再提 IO，最后收敛 facade；type-only import 单独验证。
- [artifact 输出漂移] → 对 fixture 产物做语义与关键字节快照，拆分前后对比。
- [范围过大] → 按 Quality、Pipeline、Shared Contracts 三批执行，每批独立验收。

## Migration Plan

不迁移用户知识数据。每批先运行旧 fixture 生成基准，再迁移 owner 并比较产物；最后删除旧 giant implementation 和 marker。

## Open Questions

无。
