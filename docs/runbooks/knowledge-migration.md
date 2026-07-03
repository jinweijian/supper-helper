# 知识库 Parent-Child V2 迁移手册

本手册用于把 legacy `semantic-section-v1/v2` 语料迁移为可审计的 `parent-child-v2`。迁移不会原地补字段伪装合规，也不会自动批准 warning/error。

## 迁移顺序

1. 运行 `knowledge migration-report`，生成 legacy inventory、模块批次状态和人工 review queue。
2. 从 canonical source 重新执行 `extract -> normalize -> slice`。新草稿必须带 `source_document_id`、`source_block_ids`、`section_path` 和 `chunking_strategy: parent-child-v2`。
3. 运行 strict audit 和 deterministic repair；修复后重新 audit。
4. 人工审核 `ai-companion`。只有 `quality_status: ok` 的 reviewed slice 可进入直答批次；warning 可供调查，但不能越过严格直答门禁。
5. 发布 AI Companion，依次重建 chunks、vector artifact，并运行 50 题 production retrieval eval。批次未通过时停止。
6. 只有 AI Companion 批次通过，才以相同步骤处理 `edusoho-training`。

## 命令

```bash
node dist/cli.js knowledge migration-report --workspace /path/to/project --knowledge-root /path/to/knowledge
node dist/cli.js knowledge extract --workspace /path/to/project --knowledge-root /path/to/knowledge
node dist/cli.js knowledge normalize --workspace /path/to/project --knowledge-root /path/to/knowledge
node dist/cli.js knowledge slice --workspace /path/to/project --knowledge-root /path/to/knowledge
node dist/cli.js knowledge audit --workspace /path/to/project --knowledge-root /path/to/knowledge --quality-gate strict
node dist/cli.js knowledge repair --workspace /path/to/project --knowledge-root /path/to/knowledge --plan
node dist/cli.js knowledge review --workspace /path/to/project --knowledge-root /path/to/knowledge --source-id <id> --action approve --reviewer <name>
node dist/cli.js knowledge publish --workspace /path/to/project --knowledge-root /path/to/knowledge --source-id <id> --quality-gate strict
node dist/cli.js knowledge update --workspace /path/to/project --knowledge-root /path/to/knowledge
node dist/cli.js knowledge vector build --workspace /path/to/project --knowledge-root /path/to/knowledge
node dist/cli.js retrieval eval --workspace /path/to/project --questions test/fixtures/retrieval/production-eval-50.json --report /path/to/holdout-report.json
```

## 发布门禁

- Holdout 直答精度：100%。
- No-hit 拒答准确率：100%。
- Must-escalate 准确率：100%。
- Recall@5：至少 90%。
- MRR：至少 0.80。
- 所有可直答 parent：active、fresh、质量 `ok|info`、来源/区块/章节溯源完整，并能提取明确 answer span。

任何门禁失败都只阻断当前模块批次。已通过的 AI Companion 批次不得被后续 EduSoho 失败回滚。

## 真实 Provider 与隐私

默认配置保持离线。真实 SiliconFlow smoke、vector build、rerank 和 holdout eval 只能在显式配置 SecretRef 或环境变量后运行。报告不得写入密钥、Authorization、原始向量、完整 provider payload 或完整文档正文；缺凭证必须记录 `not run`。
