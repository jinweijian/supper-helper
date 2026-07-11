## Why

Knowledge quality 与多个 pipeline/domain 文件仍超过仓库规定的职责和行数边界，部分所谓 owner 只是反向 re-export 到巨型实现。需要完成真实规则、I/O、contract 和 adapter 拆分，并用端到端 pipeline 证明新路径有效。

## What Changes

- 将 Quality audit rules、report IO、gate、chunk map 迁移到真实 owner。
- 拆分 Knowledge extract/slice/repair/publish/vector/frontmatter 与共享 types/config/domain 的混合职责。
- 删除 marker/反向 re-export，要求生产 importer 使用新 owner。
- 对 TS/Vue 实现文件设置 300 行闸门，例外必须在 design 中逐项说明。
- 增加真实临时目录的 ingest→audit→publish→index→retrieve acceptance。

## Capabilities

### New Capabilities

- `real-knowledge-domain-owners`: Knowledge/domain/config 真实职责归属和端到端可达性合同。

### Modified Capabilities

- `module-boundary-debt-cleanup`: 禁止 marker 文件和巨型实现反向出口。
- `knowledge-local-module-boundaries`: Knowledge pipeline 按 rules、I/O、artifact 和 contracts 拆分。

## Impact

影响 Knowledge pipeline、共享 contracts/config、CLI importers、模块边界测试和架构文档；不改变公开知识 artifact shape，确需例外时必须有兼容测试。
