## Why

Knowledge health service 当前反向依赖 Retrieval，且 Session health 默认可能触发远程 embedding/rerank。健康检查必须拆成本地状态与显式检索 probe，并由 application use-case 层组合相邻模块。

## What Changes

- 新增 application 层的 Knowledge Management use case。
- Knowledge 只返回本地目录、索引、向量兼容和静态 search 状态。
- Session health 默认不联网；只有显式 query/probe 才调用配置化 Retrieval。
- 保持 `/api/knowledge/*` 和 session health DTO shape 兼容。

## Capabilities

### New Capabilities

- `application-knowledge-health`: 本地健康、显式检索 probe、bind 和 reindex 的用例编排合同。

### Modified Capabilities

- `knowledge-local-module-boundaries`: Knowledge 不得 import Retrieval。
- `configured-retrieval-path`: 远程检索只由显式 probe 或 Runtime 触发。

## Impact

新增 `src/application/`，调整 Gateway knowledge/session routes、Knowledge health 和 Retrieval composition；需要真实 HTTP/provider trap 验收，response shape 不变。
