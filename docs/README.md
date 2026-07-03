# super helper 文档中心

这个目录按读者和用途组织。新同学不要从文件名猜阅读顺序，按下面路径进入即可。

## 我想了解产品

先读：

1. [PRD](prd/README.md)
2. [产品迭代规划](prd/evolution-plan.md)

适合产品、运营、客服、销售、技术支持了解：这个工具解决什么问题，用户怎么问，系统怎么回答，哪些场景不做。

## 我想了解技术方案

先读：

1. [架构入口](architecture/README.md)
2. [系统总览](architecture/overview.md)
3. [用户问题如何被回答出来](architecture/runtime/README.md)

如果只想知道全局边界，读 `architecture/overview.md`。如果要看用户输入之后每个功能块如何协作，进入 `architecture/runtime/`。

## 我想改代码

必须先读：

1. [开发标准](standards/development.md)
2. [模块边界规范](standards/module-boundaries.md)
3. [系统总览](architecture/overview.md)
4. [产品 Agent 设计](architecture/agents.md)
5. [产品 Agent 配置目录](../src/agents/README.md)
6. [主 Agent 配置](../src/agents/main.md)

这些文档定义模块归属、禁止依赖、Evidence Review 合同、runtime 边界和验证要求。

## 我想排查或运维

常用入口：

- [命令白名单](standards/command-whitelist.md)
- [知识库迁移 Runbook](runbooks/knowledge-migration.md)
- [Runtime 可观测性与 Case 沉淀](architecture/runtime/observability-curation.md)

## 我想看路线图或历史设计

- [MVP Roadmap](roadmap/mvp.md)
- [历史 Superpowers plans/specs](archive/superpowers/)

`archive/` 是历史实现计划和设计快照，不代表当前架构权威。当前权威以 `prd/`、`architecture/`、`standards/` 为准。
