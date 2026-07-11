# Product Agents

`src/agents/` 是产品运行时 Agent 配置的唯一权威目录。

根目录 `AGENTS.md` 是仓库开发规范，不是产品 Agent 配置。

## Current Agents

- `main.md`: 主 Agent，负责完整用户回合、AnswerGoal 所有权、协同调度和最终回复责任。
- `input-review.md`: 输入审核与 Preflight Gate Agent。
- `experience.md`: 历史经验复用 Agent。
- `knowledge-router.md`: 知识路由 Agent，负责模块、意图、关键词和升级信号识别。
- `evidence-judge.md`: 证据充分性 Agent，负责判断知识库证据是否足够或是否需要查代码。
- `rag-answerability.md`: RAG 可回答性与有效信息萃取 Agent，负责判断知识库结果是否满足 AnswerGoal，并在 partial 时输出可保留 claim 和升级焦点。
- `mcp-planner.md`: MCP 只读调用规划 Agent，受 Runtime 两次调用预算约束。
- `mcp-evidence-extractor.md`: MCP evidence envelope 校验与 claim 绑定 Agent，不产生用户可见文本。
- `case-curator.md`: Case 沉淀 Agent，负责生成待复核 solved case 草稿。
- `output-review.md`: 证据与输出审核 Agent。
- `presentation.md`: 美化输出 / persona-aware presentation Agent。
- `registry.json`: runtime stage 到 Agent 配置的配对表。

`registry.json` 的可选 `executionMode` 用于说明阶段权威边界：`deterministic`、`model_assisted` 或 `presentation_only`。该字段会通过 `/api/agents` 只读暴露；既有字段保持兼容。

## Extension Rules

新增 Agent 时：

1. 在本目录新增 kebab-case markdown 配置。
2. 在 `registry.json` 增加 stage 配对。
3. 配置必须写明 role、responsibility、input contract、output contract、allowed dependencies，以及是否允许产生用户可见文本。
4. 不要把产品 Agent prompt 散落到 runtime、worker、docs 或根目录文件中。
