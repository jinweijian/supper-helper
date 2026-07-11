## Context

当前拆分把巨型实现移动到 `event-recorder-impl.ts`、`run-service.ts`，其他 phase/service 文件只是 marker 或重复 re-export。结构测试因此可能假绿。Main Agent 配置也重复多个阶段合同并与实际 per-case Claude session 冲突。

## Goals / Non-Goals

**Goals:**

- 让生产调用真实经过 phase/service owner。
- 保持现有公开 exports、事件 phase、Onboarding API 和持久化 shape。
- 让结构测试能够识别空壳拆分。

**Non-Goals:**

- 不改变 Onboarding 产品流程、Agent outcome 或 HTTP DTO。

## Decisions

1. Event Recorder 使用共享 sink/base 加按 conversation/preflight/knowledge/review/curator/worker 分组的真实方法集合；聚合器通过类型组合暴露现有 flat methods，旧 giant impl 删除。
2. Onboarding facade 组合 DraftService、ReviewService、RunService、SecretsService；每个 service 拥有自己的校验和 repository 调用，run orchestration 不反向导出完整 facade。
3. Main Agent 配置只保留身份、AnswerGoal 所有权、全局证据与隐私原则；阶段 schema 和示例留在对应 Agent/代码 contract。明确 Claude session per Case。
4. 结构测试除文件存在外，还必须验证 owner 导出实际生产 symbol、至少一个 production importer、无反向 import giant implementation，并对实现文件执行 300 行 gate。
5. 仅 re-export 的公共兼容 facade 可超过零逻辑但必须不含业务分支；marker 常量文件删除。

## Risks / Trade-offs

- [大量机械移动引入行为差异] → 先为 public symbol identity、事件序列和 onboarding HTTP 建快照/契约测试，逐 owner 迁移。
- [300 行导致过度拆分] → 按职责拆，不按任意片段拆；纯 schema/fixture 例外需 design 明示和测试引用。

## Migration Plan

分 Event Recorder、Onboarding、Agent 三批，每批独立保持全绿。旧入口最后删除或保留窄 facade，不改变消费者路径。

## Open Questions

无。
