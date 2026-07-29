## Context

当前项目已具备多策略 retrieval、RRF fusion、parent dedupe、rerank、`KnowledgeEvidencePack`、Evidence Judge、RAG Answerability 和统一 Review。最小图检索扩展点是新增 sibling recall strategy，而不是替换 Runtime 或让图谱直接生成用户答案。

数据特征不同：产品文档和白皮书适合建立模块、角色、能力、配置、版本与术语关系；Redmine 天然包含 project、tracker、status、category、journal 和 issue relation，更适合调查型与时序图谱；FAQ 和 runbook 仍以精确文本与完整步骤检索为主。

Obsidian 的 Markdown、frontmatter、wiki links 和标签适合知识作者工作台，但 Obsidian Graph View 只有无类型链接，不能替代具有 relation type、provenance、confidence、version、visibility 的运行时知识图谱。

## Goals / Non-Goals

**Goals:**

- 验证图召回是否在跨文档、多跳、术语别名、Redmine 相似案例和版本时序问题上带来可量化增益。
- 保证 direct-answer precision、no-hit abstention、must-escalate、visibility 和版本安全不退化。
- 比较最小自建 metadata graph、LightRAG `mix` 和 Graphiti Redmine 时序子集的效果与维护成本。
- 明确 Obsidian 作者工作台到 canonical published Markdown 的治理流程。
- 为后续正式实施 change 产出可复现结论。

**Non-Goals:**

- 不用知识图谱替换 BM25、Embedding、RRF、rerank 或 canonical parent evidence。
- 不让图路径、实体摘要或开源方案生成的回答绕过 Evidence Judge/Review。
- 不在本调研中设计完整企业本体或部署 OpenSPG/KAG 生产栈。
- 不修改 `src/`、HTTP response shape、Case JSON shape 或持久化 knowledge contract。
- 不把 Obsidian vault 直接作为 Runtime source of truth。

## Decisions

### D1：评估“Graph-assisted Hybrid”，不评估纯替换

主对照组：

| 组 | 方案 | 目的 |
| --- | --- | --- |
| A | 当前 BM25 + Embedding + RRF + rerank | 安全与效果基线 |
| B | A + 确定性 metadata Graph Recall | 验证最小集成增益 |
| C | LightRAG `mix` | 验证完整开源 graph+text 管线 |
| D | Graphiti Redmine 子集 | 验证时序与增量工单关系 |

纯 graph-only 只允许作为诊断组，不允许成为推荐生产方案。

### D2：第一阶段图边只来自显式、可溯源字段

允许自动构建：document→module、document→term、document→repo、document→source document、taxonomy alias、issue→project/tracker/status/category，以及源数据明确给出的 issue relation。

自由文本抽取出的 rule→exception、case→root cause 等关系第一阶段只进入 shadow 数据，不参与回答或排序。每条正式实验边必须保留 source identity、source block/episode、extraction method、confidence、visibility 和可用版本信息。

### D3：图召回必须回落到 canonical parent/chunk

图召回输出不是实体或三元组结论，而是 canonical `documentId/parentId` 候选，再定位相关 child，转换成现有 `RetrievalCandidate`。最终继续经过 fusion、rerank、`KnowledgeEvidencePack`、Evidence Judge、RAG Answerability、Review。

### D4：Obsidian 只做作者工作台

建议流程：

```text
Obsidian Vault
  draft / links / properties
        -> publish validation
Canonical Published Markdown
        -> Text Index + Graph Index
```

Obsidian properties 映射现有 frontmatter；wiki links 只作为候选关系，正式发布时需转换成 typed relation。`draft/review_required/deprecated` 不进入直接回答索引。`.obsidian/` 配置与第三方插件数据不进入 Runtime。

### D5：候选项目短名单

- LightRAG：第一轮完整 POC，使用 `mix`，重点评估引用、增量更新和中文关系抽取。
- Graphiti：只评估 Redmine 时序/版本/journal，重点评估 episode provenance 和事实有效期。
- OpenSPG/KAG：文档调研和 schema 草案，不在第一轮部署；当领域 schema 与逻辑推理需求稳定后再评估。
- HippoRAG：仅作为多跳检索算法参考。
- Microsoft GraphRAG：仅作为全局总结基准，不进入第一轮；索引成本和静态批处理不匹配当前动态工单场景。
- RAGFlow/Cognee/Neo4j GraphRAG：记录平台能力与依赖成本，不作为第一轮主对照。

### D6：评测集与发布门槛

在现有安全回归集外新增至少 60 题：单文档精确/改写、跨模块关系、多文档规则聚合、术语别名、Redmine 相似案例、时效/冲突/版本、generic/no-hit/权限。

必须统计 Recall@5、MRR、multi-parent Recall@5、complete-support rate、graph unique gain、graph false-expansion、answer-bearing@5、edge provenance precision、entity-link accuracy、visibility/version violation、Worker escalation、P50/P95 latency 和索引成本。

推荐门槛：direct-answer precision、no-hit abstention 和 must-escalate 不下降；visibility/version violation 为 0；关系型问题 Recall@5 与 complete-support rate 相对提升至少 10%；总体 MRR 不下降。

## Risks / Trade-offs

- [LLM 抽取错误被图遍历放大] → 第一阶段只用显式 metadata 建正式边，自由文本关系仅 shadow。
- [hub 节点产生误扩展] → 统计 false-expansion，限制 hop、relation type 和 visibility，再交给 rerank。
- [图路径泄漏受限知识] → 遍历前按 visibility 过滤节点和边，不只过滤最终候选。
- [旧版本关系污染当前答案] → 边保留版本/有效期；缺版本时只作为调查线索。
- [LightRAG/Graphiti 引入 Python sidecar 和存储] → POC 不接 Runtime，先测增益与运维成本。
- [Obsidian 双链质量不稳定] → 双链只作候选关系，发布验证生成 typed edge。
- [当前切片缺陷掩盖图谱价值] → A/B 使用同一修复后 canonical chunks，保证对照公平。

## Migration Plan

本 change 无生产迁移。所有数据集、脚本、结果和 findings 均位于 change 的 `spikes/`。选型后另立实施 change，正式接入时再定义 graph artifact version、provider/sidecar、migration 和 rollback。

## Open Questions

- 用户所说 `openknowlage` 是否有准确 URL；当前精确 GitHub 搜索无匹配，可能指 OpenSPG/KAG 或 OpenKG。
- Obsidian 是单人 Git vault 还是多人协作；这决定同步、权限与审核方式。
- Redmine 原始 relations、fixed version 和 journal 字段当前导入是否完整保留；实验前需确认源 JSON。
- 第一轮可接受的 P95 检索延迟预算是多少。
