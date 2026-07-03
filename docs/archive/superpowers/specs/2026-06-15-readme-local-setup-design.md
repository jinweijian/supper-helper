# README 本地启动流程重构设计

## 背景

当前 `README.md` 同时描述源码开发、未来 npm 全局安装、知识库流水线、模型配置和 MCP 配置，但没有先建立一条明确可执行的首次启动路径。

主要问题：

- 示例包含 `/Users/king/...` 等个人机器绝对路径。
- 当前可用的 `node dist/cli.js` 与未来发布后才可用的 `super-helper` 命令混在一起。
- 没有明确说明 `dist/` 默认不存在，执行 CLI 前必须先运行构建。
- 没有区分 super-helper 源码目录、被诊断项目目录和知识库目录。
- 初始化配置、设置目标项目、启动服务和初始化知识库之间的依赖关系不清楚。
- 高级能力说明出现在首次启动主流程中，降低了可读性。

## 目标读者和默认场景

README 的默认读者是从源码仓库运行 super-helper 的本地开发者或使用者。

默认场景固定为：

1. 在本地安装并构建 super-helper 源码。
2. 让 super-helper 检查另一个本地项目目录。
3. 可选地为目标项目初始化独立知识库。
4. 启动本地 HTTP 服务并通过浏览器使用。

“诊断 super-helper 自身”和“未来 npm 全局安装”作为独立补充场景，不进入首次启动主路径。

## 路径模型

README 在任何启动命令之前先定义三个路径：

```bash
export SUPER_HELPER_ROOT="/path/to/super-helper"
export TARGET_WORKSPACE="/path/to/project-to-diagnose"
export KNOWLEDGE_ROOT="/path/to/super-helper-knowledge"
```

- `SUPER_HELPER_ROOT`：super-helper 源码仓库，用于安装依赖、构建和执行 `dist/cli.js`。
- `TARGET_WORKSPACE`：被诊断项目，对应配置中的 `workspaces[].rootPath` 和 CLI 的 `--workspace`。
- `KNOWLEDGE_ROOT`：可选的知识库工作区根目录，对应 CLI 的 `--knowledge-root`。

所有示例使用这些变量或 `/path/to/...` 占位路径，不出现作者机器路径。

## README 信息架构

README 按以下顺序重组：

1. 项目简介
2. 当前能力和工作模式
3. 前置条件
4. 三个路径分别是什么
5. 五分钟快速开始
6. 知识库初始化与使用（可选）
7. 配置和数据保存位置
8. 常用命令
9. Agent 模型配置
10. Embedding 与 Rerank
11. MCP 配置
12. 开发与验证
13. 架构和开发规范文档
14. 未来 npm 安装形态

高级配置必须放在快速开始和基础验证之后。

## 快速开始流程

快速开始只保留一条从源码可执行的路径：

```bash
cd "$SUPER_HELPER_ROOT"
pnpm install
pnpm build
node dist/cli.js init
node dist/cli.js workspace set \
  --path "$TARGET_WORKSPACE" \
  --name "My Project"
node dist/cli.js doctor
node dist/cli.js dev --workspace "$TARGET_WORKSPACE"
```

每一步都解释：

- 在哪个目录执行。
- 会创建或修改什么。
- 成功时应看到什么。
- 是否为必需步骤。

README 必须明确：

- `init` 创建 `~/.super-helper/config.json`。
- `workspace set` 持久化默认目标项目。
- `dev --workspace` 可以为当前启动临时指定目标项目。
- 启动成功后，终端会打印浏览器访问地址。
- 默认不要求先配置 Agent 模型、Embedding、Rerank 或 MCP。
- 默认本地规则仍能启动服务；Claude Code 是否可用由 `doctor` 检查。

## 知识库流程

知识库作为可选流程，放在服务基础启动之后。

基础命令使用显式知识库路径：

```bash
node "$SUPER_HELPER_ROOT/dist/cli.js" knowledge init \
  --workspace "$TARGET_WORKSPACE" \
  --knowledge-root "$KNOWLEDGE_ROOT"
```

README 需要说明：

- 显式传入 `--knowledge-root` 时，该路径就是知识工作区根目录。
- 实际可编辑内容位于 `$KNOWLEDGE_ROOT/knowledge/`。
- 如果不传 `--knowledge-root`，系统使用 `~/.super-helper/config.json` 中的 `knowledge.rootDir`，并默认按 workspace 隔离。
- 原始资料通过 `--source-dir` 导入。
- 导入产生草稿，不会自动发布为 active 知识。
- 使用顺序为 `init`、`review`、`publish`、`update`、`search`。

知识库高级流水线命令保留，但从首次启动流程中移出。

## 命令一致性规则

- 当前源码模式统一使用 `node "$SUPER_HELPER_ROOT/dist/cli.js"`。
- 在已经 `cd "$SUPER_HELPER_ROOT"` 的连续命令块中，可以缩写为 `node dist/cli.js`。
- 不在当前可运行流程中使用尚未发布的全局 `super-helper` 命令。
- 全局命令只出现在“未来 npm 安装形态”章节，并明确标记为当前不可用或尚未发布。
- 每个命令块必须可以独立判断所需当前目录和变量。
- 尖括号占位符只用于必须由用户提供的动态值，例如 `<source-id>` 和 `<reviewer-name>`。

## 配置说明

README 需要给出最小配置字段映射：

| 用户概念 | 配置字段 | CLI 参数 |
| --- | --- | --- |
| 被诊断项目 | `workspaces[].rootPath` | `--workspace` / `workspace set --path` |
| 知识库基目录 | `knowledge.rootDir` | `--knowledge-root` |
| 会话存储目录 | `storage.rootDir` | 当前通过配置文件设置 |
| workspace 隔离 | `knowledge.isolateByWorkspace` / `storage.isolateByWorkspace` | 当前通过配置文件设置 |

同时说明项目中不存在 `workspec` 或 `pathRoot` 字段，避免使用者按错误名称搜索配置。

## 验证和错误处理

快速开始包含以下最小验证：

```bash
node "$SUPER_HELPER_ROOT/dist/cli.js" doctor
```

常见问题章节至少覆盖：

- `dist/cli.js` 不存在：运行 `pnpm build`。
- `pnpm` 不存在：安装符合 `package.json` 要求的 pnpm。
- Claude Code 显示 `not available`：服务仍可启动，但代码诊断 worker 不可用。
- `TARGET_WORKSPACE` 不存在：修正目标项目绝对路径。
- 知识库搜索无结果：确认文档已审核、发布并执行 `knowledge update`。
- Agent 模型缺少 API key：设置对应环境变量，或保持本地规则模式。

## 保留与迁移

保留现有关于以下能力的说明，但移动到高级章节并减少重复：

- Agent 模型提供方
- SiliconFlow Embedding
- SiliconFlow Rerank
- 向量产物
- MCP 工具
- 知识库审核和发布

删除或替换：

- 所有 `/Users/king/...` 示例。
- 快速开始中的未来全局命令。
- 重复出现但未解释路径含义的知识库命令。
- 与当前实现不一致或没有状态标记的发布设想。

## 验收标准

README 重写完成后应满足：

1. 新用户只阅读“前置条件”“路径说明”“五分钟快速开始”即可从源码启动服务。
2. 用户能明确区分源码目录、目标项目目录和知识库目录。
3. README 不包含任何个人机器绝对路径。
4. 当前可运行命令与未来 npm 命令不混用。
5. 每条主流程命令与 `src/cli.ts` 当前实现一致。
6. 用户能找到配置文件位置和关键字段。
7. 用户能理解知识库是可选能力，且未经审核的导入草稿不会直接参与回答。
8. `pnpm lint` 通过。
