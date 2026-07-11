## Context

`src/knowledge/health-service.ts` 当前创建配置化 Retriever，导致 Knowledge 反向依赖 Retrieval。Session 序列化又默认带最新用户 query，因此一次普通读取可能触发远程 embedding/rerank。

## Goals / Non-Goals

**Goals:**

- 本地 health 永远不联网、不产生费用。
- 显式 probe 复用生产 Retrieval composition。
- Gateway 只调用 application use case，DTO shape 不变。

**Non-Goals:**

- 不重写 Retrieval 算法，不改变 knowledge artifact。

## Decisions

1. 新增 `src/application/knowledge-management-service.ts` 作为用例组合层，可依赖 Knowledge local service 与 Retrieval service；相邻底层模块不得反向依赖 application。
2. `getLocalHealth` 只计算 binding/index/embedding artifact compatibility，search 返回 waiting/off 状态，不调用 provider。
3. `probeSearch` 只有显式 query 参数或 UI 操作触发，调用现有 configured retrieval，并把结果映射到既有 search DTO。
4. Session serialization 无论是否有消息都只调用 local health。`/api/knowledge/health?query=...` 保持显式 probe 兼容；无 query 时 local-only。
5. bind/reindex 仍由 application service 编排 Knowledge init/index 和之后的 local health，不自动 probe。

## Risks / Trade-offs

- [用户打开会话后看不到自动命中数] → UI 提供明确“测试检索”，避免隐式费用与数据外发。
- [application 层成为杂物层] → 只允许跨 Knowledge/Retrieval 的用例组合，不拥有算法、DTO 或持久化细节。

## Migration Plan

保持所有响应字段；先增加 provider trap 失败测试，再替换 Gateway importer，最后删除 Knowledge 对 Retrieval 的 import。

## Open Questions

无。
