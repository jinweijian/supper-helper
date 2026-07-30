# 知识库 Parent-Child V4 迁移与回滚手册

本手册用于把 legacy `semantic-section-v1/v2`、`parent-child-v2/v3` 与平面索引迁移为
`parent-child-v4` immutable generation。迁移不会原地补字段伪装合规，也不会在普通检索请求中自动写入。

## 迁移顺序

1. 运行 `knowledge migration-report`，生成 legacy inventory、模块批次状态和人工 review queue。
2. 从 canonical source 重新执行 `extract -> normalize -> slice`。新草稿必须带
   `source_document_id`、`source_block_ids`、`section_path` 和 `chunking_strategy: parent-child-v4`。
3. 运行 strict audit 和 deterministic repair；修复后重新 audit。
4. 人工审核 `ai-companion`。只有 `quality_status: ok` 的 reviewed slice 可进入直答批次；warning 可供调查，但不能越过严格直答门禁。
5. 通过 application rebuild 用例构建完整候选 generation。embedding 禁用时发布完整
   BM25-only；embedding 启用/被请求时 chunks、keyword/BM25、vectors、vector manifest
   必须全部成功后一次激活。
6. publisher 持有 cross-process lock，核对 `expectedActiveGenerationId`，校验 count、唯一 ID、
   v4 strategy、file hash、vector dimension 后，仅原子替换 `active.json`。
7. 运行固定 50 题 production retrieval eval。批次未通过时停止。
8. 只有 AI Companion 批次通过，才以相同步骤处理 `edusoho-training`。

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
- 所有 strict-direct child：`artifact_version=4`、`parent-child-v4`、非
  `undersized_unmergeable`、非 `manual_split_required`。
- canonical `text` 只保存正文；embedding/rerank 使用 bounded section path + body 的
  `retrieval_text`。Evidence、Case、日志和回复不得保存完整 retrieval text。

任何门禁失败都只阻断候选 generation，不修改 active pointer。旧 flat/v2/v3 仍可作有界调查，
但返回 `rebuild_required` 且不可 strict direct answer。

## 并发、崩溃与回滚

- Reader 每个请求只解析一次 active generation；发布中途切换不会让同一请求混读两代。
- 两个 publisher 从同一 expected active 出发时只有一个能成功；另一个返回
  `generation_conflict`，不得覆盖 winner。
- fresh lock 返回 bounded busy。崩溃残留 stale lock 只能由显式 recovery 用例在核验
  owner/PID/age 后清理；普通请求不得偷锁。
- 没有完整 manifest/complete marker 的 generation 不可激活。
- rollback 也必须获得同一 publish lock，使用 expected-active CAS，并校验 previous generation
  的 manifest/file hashes 后原子切回；不会重建或改写旧 generation。

## 真实 Provider 与隐私

默认配置保持离线。真实 SiliconFlow smoke、vector build、rerank 和 holdout eval 只能在显式配置 SecretRef 或环境变量后运行。报告不得写入密钥、Authorization、原始向量、完整 provider payload 或完整文档正文；缺凭证必须记录 `not run`。
