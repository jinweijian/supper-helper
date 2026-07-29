## 1. 数据盘点与评测集

- [ ] 1.1 盘点产品文档、白皮书、FAQ、runbook 和 Redmine 原始数据，记录数量、格式、frontmatter 完整度、版本/visibility/provenance 字段与更新频率
- [ ] 1.2 确认 Redmine 原始 JSON 是否完整保留 issue relations、fixed version、journal 时间线、status/assignee/category 等字段，并记录当前导入缺口
- [ ] 1.3 基于真实问题建立至少 60 题评测集，覆盖单文档、跨模块、多文档、术语别名、Redmine 相似案例、版本/冲突、no-hit、generic 和权限场景
- [ ] 1.4 为每题标注 expected parent set、direct/abstain/escalate、allowed visibility、applicable version、maximum graph hops 和是否需要当前代码验证
- [ ] 1.5 运行当前 Hybrid RAG 基线并记录 Recall@5、MRR、direct precision、no-hit abstention、must-escalate、answer-bearing@5、P50/P95 延迟

## 2. Obsidian 作者工作台调研

- [ ] 2.1 建立最小 Obsidian vault 样例，导入少量产品文档、白皮书和 Redmine 卡片，验证 Markdown/frontmatter/wiki links/tags/附件兼容性
- [ ] 2.2 设计 Obsidian properties 到现有 knowledge frontmatter 的映射，以及 wiki links 到 typed relation 候选的发布转换规则
- [ ] 2.3 验证 draft/review/published/deprecated、visibility、source document/block、quality 和 Git 审核流程，确保未发布内容不会进入直接回答索引
- [ ] 2.4 对比 Obsidian、直接 canonical Markdown、Outline/BookStack/Logseq 的作者体验、协作、权限、Git 与自动化导入成本，形成 authoring-layer 结论

## 3. 确定性 Metadata Graph Recall

- [ ] 3.1 在 `spikes/` 定义最小节点/边模型：Document/Parent/Module/Term/Repo/SourceDocument/RedmineIssue/Project/Tracker/Status/Category
- [ ] 3.2 仅从显式 frontmatter、taxonomy 和 Redmine 明确字段构建本地可重建 graph artifact，每条边记录 provenance、confidence、visibility 和版本/有效期
- [ ] 3.3 实现实验性 graph recall：实体/别名匹配、限定 relation/hop 遍历、映射回 canonical parent/chunk，输出可与当前候选对比的结果
- [ ] 3.4 先以 shadow mode 运行，统计 graph unique gain、false-expansion、entity-link accuracy、edge provenance precision、visibility/version violations
- [ ] 3.5 通过 shadow 安全门槛后，让 graph 候选参与离线 RRF/rerank，完成 A（当前）与 B（图辅助）对照

## 4. LightRAG Mix POC

- [ ] 4.1 用 Docker 或隔离 Python 环境部署 LightRAG，记录许可证、资源占用、存储依赖、模型配置和中文设置
- [ ] 4.2 导入与 A/B 相同的 canonical corpus，启用引用、heading context、增量更新和文档删除，记录索引时长、token 成本和索引体积
- [ ] 4.3 在同一评测集运行 `naive` 与 `mix`，提取 retrieved contexts/citations，不直接采用 LightRAG 自由生成答案
- [ ] 4.4 将 LightRAG contexts 映射到 expected parent/source，计算与 A/B 相同的质量、安全和延迟指标

## 5. Graphiti Redmine 时序 POC

- [ ] 5.1 在隔离环境部署 Graphiti + Neo4j/FalkorDB，禁用可选 telemetry，记录依赖和资源成本
- [ ] 5.2 选取有状态变化、版本变化、journal 和 issue relation 的 Redmine 子集，以 episode 方式增量导入
- [ ] 5.3 验证当前事实、历史事实、valid-from/valid-to、episode provenance、增量更新与冲突处理
- [ ] 5.4 在 Redmine 子集评测相似案例、版本/时序和关系问题，记录检索效果、延迟、抽取失败和错误关系比例

## 6. 重型候选文档调研

- [ ] 6.1 调研 OpenSPG/KAG 的 schema-constrained construction、chunk-knowledge mutual index、logical-form reasoning、部署栈和中文生态，判断何时值得进入第二轮 POC
- [ ] 6.2 调研 Microsoft GraphRAG 的 global/local/DRIFT 检索、索引成本和增量局限，明确为何只作为全局总结参考
- [ ] 6.3 调研 HippoRAG、RAGFlow、Cognee、Neo4j GraphRAG 的定位、成熟度、许可证、部署复杂度和与现有 Evidence contract 的适配成本
- [ ] 6.4 若用户提供 `openknowlage` 准确 URL，补充该项目的成熟度、许可证、数据模型、引用和增量更新评估

## 7. 汇总与选型

- [ ] 7.1 汇总 A/B/C/D 的 Recall@5、MRR、multi-parent Recall@5、complete-support、unique gain、false-expansion、direct precision、abstention、must-escalate、违规数、延迟和索引成本
- [ ] 7.2 人工复核每类至少 5 题，评分“是否解决原始问题、是否保留完整步骤、引用是否可验证”
- [ ] 7.3 写 `spikes/findings.md`：Obsidian 治理结论、候选项目矩阵、实验数据、风险、最终推荐与不推荐理由
- [ ] 7.4 若任一候选满足安全非劣化且关系问题提升门槛，提出独立实施 change；否则明确保留修复后的 Hybrid RAG 并归档本调研
