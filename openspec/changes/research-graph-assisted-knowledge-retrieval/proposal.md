## Why

当前知识检索对单文档精确问题有效，但产品文档、白皮书和 Redmine 工单包含大量跨文档关系、术语别名、版本变化与历史案例关联，现有 chunk-based Hybrid RAG 难以稳定覆盖。与此同时，直接用知识图谱替换 RAG 会损失精确段落、操作步骤、no-hit 和证据溯源能力，因此需要先用真实数据验证“Graph-assisted Hybrid Retrieval”是否值得引入。

本 change 是纯调研：不改变生产 Runtime、HTTP、Case 或 Knowledge Evidence contract，只建立可复现实验、比较候选开源方案并产出选型结论。

## What Changes

- 建立面向产品文档、白皮书和 Redmine 的关系型评测集，补充现有单文档 retrieval evaluation。
- 对比当前 BM25 + Embedding + RRF + rerank 基线、基于显式 metadata 的确定性 Graph Recall、LightRAG `mix` 模式。
- 对 Redmine 版本/状态/journal 时间线单独评估 Graphiti，不把时序图结果直接作为最终答案证据。
- 评估 Obsidian 作为知识作者工作台的适配性，明确它不替代 canonical published Markdown 和现有发布审核边界。
- 文档调研 OpenSPG/KAG、Microsoft GraphRAG、HippoRAG、RAGFlow、Cognee 和 Neo4j GraphRAG，说明进入或不进入后续 POC 的理由。
- 产出决策矩阵和明确结论：继续纯 Hybrid RAG、增加 Graph Recall sibling strategy、引入独立 GraphRAG sidecar，或放弃图检索方向。
- 所有 spike 只放 change 目录，不进入 `src/`；选型后另立正式实施 change。

## Capabilities

### New Capabilities

- `graph-assisted-retrieval-evaluation`: 定义图辅助知识检索调研的评测集、对照组、安全门槛、Obsidian 治理边界和最终选型交付物。

### Modified Capabilities

（无，本 change 不修改生产需求。）

## Impact

- 调研 artifacts 位于 `openspec/changes/research-graph-assisted-knowledge-retrieval/`。
- spike 原型只允许写入该 change 的 `spikes/`，不修改 `src/`、API response shape、Case JSON shape 或知识发布 contract。
- 实验会消耗有限的 LLM/embedding token 和本地存储；第一轮数据集应控制在可人工复核的规模。
- 若调研结论为采用图召回，后续正式方案应把图资产放入 `src/knowledge/indexes/`，把 graph recall 放入 `src/retrieval/recall/graph/`，并继续回落到 canonical parent/source block 证据。
