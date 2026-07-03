# Dashboard 一键 Onboarding 设计

## 状态

本设计已完成用户确认。

它取代 `2026-06-15-readme-local-setup-design.md` 中“依次执行 init、workspace、knowledge、模型配置命令”的首次启动方案。旧设计保留为问题背景和迁移记录，不再作为实施目标。

## 背景

当前 super helper 的首次使用需要分别执行或理解：

- 构建项目
- 初始化配置
- 配置 workspace
- 初始化知识库
- 导入、提取、标准化、切片、审计、审核、发布和索引
- 配置并测试 Agent 模型
- 配置并测试 Embedding
- 配置并测试 Rerank
- 启动服务

这套流程步骤多、概念暴露过早、容易遗漏，也无法在耗时任务执行期间提供可恢复的真实进度。

目标是参考 OpenClaw 的命令语义，建立由 Dashboard 驱动的一键 onboarding：

```bash
super-helper onboard
super-helper dashboard
super-helper doctor
super-helper status
```

当前源码开发阶段通过 pnpm script 暴露同样的行为。

## 产品目标

首次用户只需要：

1. 执行一个命令。
2. 在浏览器 QuickStart 中填写少量必要信息。
3. 点击一次“检查并执行”。
4. 等待系统自动完成配置、模型测试、知识处理、索引和健康检查。
5. 初始化完成后直接进入日常 Dashboard。

系统必须：

- 保留现有模块边界。
- 保留知识证据质量门禁。
- 不把未经质量门禁的切片直接作为可用知识。
- 不在失败时提交半成品正式配置。
- 在页面刷新或关闭后恢复任务进度。
- 支持重复执行 onboarding，而不删除历史数据或重复处理未变化文件。
- 支持绑定 `0.0.0.0` 发布到可信内网。

## 命令契约

### 源码开发态

```bash
pnpm onboard
pnpm dashboard
pnpm dashboard -- --bind lan
pnpm doctor
pnpm status
```

pnpm script 负责执行必要构建并调用编译后的 CLI。

### npm 发布后

```bash
super-helper onboard
super-helper dashboard
super-helper dashboard --bind lan
super-helper doctor
super-helper status
```

源码态和发布态的 CLI 参数、状态输出和服务行为必须一致。

### `onboard`

```bash
super-helper onboard [--bind loopback|lan] [--host <ip>] [--port <port>]
```

行为：

1. 加载现有配置；没有配置时创建内存默认配置，但不立即提交。
2. 启动本地 HTTP 服务。
3. 自动打开 `/setup`。
4. 已配置时进入重新配置模式并预填现有值。
5. 用户执行一键初始化后，服务继续运行。
6. 初始化成功时页面自动进入日常 Dashboard。

`onboard` 可重复运行：

- 不清空知识库。
- 不删除历史会话。
- 不删除索引。
- 不重复处理内容哈希未变化的源文件。
- 只更新用户确认的配置。
- 允许重新执行模型连通性测试。

本次 MVP 不提供 `--reset`。

### `dashboard`

```bash
super-helper dashboard [--bind loopback|lan] [--host <ip>] [--port <port>]
```

行为：

- 启动 HTTP 服务并打开浏览器。
- onboarding 已完成时打开日常 Dashboard。
- onboarding 未完成时跳转 `/setup`。
- 服务在命令前台持续运行。

### `doctor`

保留并扩展现有 doctor：

- 配置文件可读写状态
- Node、pnpm 和构建产物
- Claude Code 可用性
- workspace 路径
- knowledge 路径
- Agent、Embedding、Rerank 配置完整度
- 最近连通性测试结果
- 最近 onboarding run 是否异常中断

`doctor` 只检查，不修改配置和知识数据。

### `status`

`status` 是只读命令，输出：

- 当前绑定模式、host 和 port
- onboarding 是否完成
- workspace 路径和健康状态
- knowledge workspace 路径、文档数、切片数和索引状态
- Agent 模型配置和最近测试状态
- Embedding 配置和最近测试状态
- Rerank 配置和最近测试状态
- 最近 onboarding run 的状态、进度和失败阶段

如果服务未运行，`status` 直接读取本地持久化状态，不要求启动 HTTP 服务。

## 网络绑定

支持：

```bash
--bind loopback
--bind lan
--host <ip>
```

规则：

- 默认 `--bind loopback`，绑定 `127.0.0.1`。
- `--bind lan` 绑定 `0.0.0.0`。
- `--host` 是高级覆盖参数，优先级高于 `--bind`。
- 用户在 Setup 中确认的绑定方式可以保存到配置，后续 `dashboard` 默认复用。
- LAN 模式启动时必须在终端和 Dashboard 显示醒目警告。
- LAN 模式只应在可信内网使用。

本次 MVP 暂不实现访问令牌、登录、用户权限和多租户安全。鉴权是后续独立能力，不能伪装为已经安全。

匿名健康接口如保留，只能返回最小存活状态，不得泄漏：

- 本地绝对路径
- 模型配置
- SecretRef
- 知识文档信息
- onboarding 草稿

## Setup Dashboard

### 页面入口

- `/setup`：首次配置和重新配置。
- `/`：日常 Dashboard。
- 未完成 onboarding 时访问 `/`，跳转 `/setup`。
- 完成 onboarding 后访问 `/setup`，显示“重新配置”模式。

### QuickStart

默认页面只显示必要输入：

1. 被诊断项目目录
2. 知识来源目录
3. Agent 模型预设和 API Key
4. Embedding/Rerank 模型预设和 API Key

用户点击一次“检查并执行”启动完整流程。

### 高级设置

折叠区包含：

- knowledge root
- storage root
- workspace name/id
- Agent provider id、base URL、API 类型、model、temperature、maxTokens、contextWindowTokens
- Embedding provider、base URL、model、dimensions、batchSize、timeout
- Rerank provider、base URL、model、topN、timeout
- Claude 超时、预算和 busy retry
- host、port、bind mode
- 是否构建向量产物

高级设置必须使用当前配置和 provider 默认值预填。

### 配置预设

预设是 UI 默认值集合，不在 onboarding 模块里硬编码厂商调用逻辑。

第一版可以提供：

- Agent：OpenAI-compatible 自定义配置
- Agent：MiniMax 预设
- Embedding/Rerank：SiliconFlow 预设
- Embedding/Rerank：禁用

provider 的远程调用仍由现有 model/embedding 模块负责。

## SecretRef

密钥不得继续作为普通配置明文字段保存。

新增独立 secrets 文件：

```text
~/.super-helper/secrets.json
```

要求：

- 创建后设置为仅当前用户可读写。
- Dashboard 输入的 API Key 保存到 secrets 文件。
- `config.json` 只保存 SecretRef。
- 高级模式允许引用环境变量。
- API、DTO、日志、状态文件、错误报告和进度事件不得返回完整密钥。
- UI 只显示“已配置”和脱敏标识，不回显密钥。

建议 SecretRef 形态：

```json
{
  "source": "file",
  "key": "providers.agent.default"
}
```

或：

```json
{
  "source": "env",
  "name": "MINIMAX_API_KEY"
}
```

现有 `apiKey` / `apiKeyEnv` 读取逻辑需要兼容迁移，但迁移不能在日志中输出原值。

## 模块边界

新增模块：

```text
src/onboarding/
  types.ts
  draft-repository.ts
  run-repository.ts
  validator.ts
  planner.ts
  runner.ts
  progress.ts
  config-commit.ts
  secrets.ts
  service.ts
```

职责：

- `types.ts`：草稿、执行计划、阶段、run、进度事件和安全错误类型。
- `draft-repository.ts`：持久化 Setup 草稿。
- `run-repository.ts`：持久化 onboarding run 和阶段结果。
- `validator.ts`：路径、字段、provider 和权限预检。
- `planner.ts`：根据草稿和现有状态生成可恢复执行计划。
- `runner.ts`：串行执行阶段，协调可并行的模型测试。
- `progress.ts`：产生真实进度事件和总体进度。
- `config-commit.ts`：成功后原子提交正式配置。
- `secrets.ts`：SecretRef 解析、保存、权限和脱敏。
- `service.ts`：供 Gateway 和 CLI 使用的公共应用服务。

现有模块保持：

- `src/gateway/`：HTTP、DTO、SSE、请求响应序列化。不得执行知识流水线或决定配置提交。
- `src/knowledge/`：导入、提取、标准化、切片、审计、发布、索引和向量产物。
- `src/embedding/`：Embedding/Rerank provider 和连通性测试。
- `src/config.ts`：正式配置加载、兼容和保存。
- `src/ui.ts`：Setup 和 Dashboard 展示，不直接执行本地文件处理。
- `src/runtime/`：产品 Agent 诊断编排，不承载 onboarding。
- `src/workers/`：诊断 worker，不承载 onboarding。

`src/cli.ts` 需要拆分命令处理器，避免继续增长为单文件业务实现。CLI 只解析参数并调用 onboarding/server/status 服务。

## Onboarding 数据

### 草稿

草稿建议存储：

```text
~/.super-helper/onboarding/draft.json
```

草稿包含：

- workspace 配置
- knowledge/storage 配置
- provider 非敏感设置
- SecretRef
- bind/host/port
- 知识来源目录
- 是否构建向量
- 草稿版本和更新时间

草稿不是正式运行配置。

### Run

每次执行生成：

```text
~/.super-helper/onboarding/runs/<run-id>.json
```

Run 至少包含：

- `id`
- `status`: `pending | running | failed | completed`
- `draftVersion`
- `currentStage`
- `overallProgress`
- `stages`
- `counters`
- `safeError`
- `retryableStage`
- `startedAt`
- `updatedAt`
- `completedAt`
- `healthSummary`

禁止在 run 中存储：

- API Key
- Authorization Header
- 完整 provider 原始响应
- 原始向量
- 完整知识切片正文

### 阶段

第一版阶段：

1. `validate_draft`
2. `test_providers`
3. `prepare_workspace`
4. `ingest_sources`
5. `extract_sources`
6. `normalize_sources`
7. `slice_sources`
8. `audit_slices`
9. `publish_approved`
10. `build_keyword_index`
11. `build_vector_index`
12. `health_check`
13. `commit_config`

禁用 Embedding 或禁用向量构建时，`build_vector_index` 标记为 `skipped`。

## 执行计划

执行顺序：

```text
保存配置草稿
→ 路径和权限预检
→ Agent / Embedding / Rerank 连通性测试
→ 初始化知识工作区
→ 增量导入与内容哈希比较
→ 提取
→ 标准化
→ 切片
→ 审计
→ 质量门禁自动发布
→ 关键词索引
→ 可选向量构建
→ 最终健康检查
→ 原子提交正式配置
```

Provider 测试可以并行，但必须各自产生独立结果。知识处理的关键阶段默认串行。

## 知识质量门禁

Onboarding 不能使用现有的 legacy active publish 旁路。

采用质量门禁自动发布：

- 审计通过、来源完整、没有 warn/error issue 的切片可以自动发布。
- warn 切片保留为待审核。
- error 切片阻止发布。
- 发布后重建关键词索引。
- Dashboard 显示：
  - 自动发布数量
  - 待审核数量
  - 阻止数量
  - 主要质量问题

正式知识依然必须满足现有 Evidence Review contract。

## 增量处理

重复执行 onboarding 时：

- 使用 source metadata 和 sha256 判断源文件是否变化。
- 未变化源文件跳过 ingest/extract/normalize/slice。
- 新增或变化文件进入处理计划。
- 已发布且来源未变化的正式知识不重复发布。
- 索引只在正式知识发生变化时重建。
- 向量 manifest 兼容且 chunks manifest 未变化时跳过向量重建。

执行计划必须在 run 开始时记录跳过原因。

## 进度模型

进度必须来自真实阶段和计数，不允许使用纯时间动画伪造百分比。

每个阶段记录：

- `status`: `pending | running | completed | failed | skipped`
- `progress`
- `processed`
- `total`
- `message`
- `startedAt`
- `completedAt`
- `safeError`

总体进度根据阶段权重和阶段内真实计数计算。

Dashboard 至少显示：

- 当前阶段
- 总体百分比
- 当前文件/切片计数
- 已完成阶段
- 跳过阶段及原因
- 警告数
- 安全错误摘要
- “从失败阶段重试”

## API 和 SSE

新增 Gateway API：

```text
GET  /api/onboarding
PUT  /api/onboarding/draft
POST /api/onboarding/validate
POST /api/onboarding/runs
GET  /api/onboarding/runs/:id
GET  /api/onboarding/runs/:id/events
POST /api/onboarding/runs/:id/retry
```

说明：

- `GET /api/onboarding` 返回完成状态、脱敏草稿摘要和最近 run。
- `PUT /api/onboarding/draft` 保存草稿，不提交正式配置。
- `POST /api/onboarding/validate` 做预检，不开始耗时任务。
- `POST /api/onboarding/runs` 基于当前草稿创建 run。
- `GET /api/onboarding/runs/:id` 用于页面刷新恢复。
- `GET /api/onboarding/runs/:id/events` 使用 SSE 推送进度。
- `POST /api/onboarding/runs/:id/retry` 从可重试失败阶段继续。
- `GET /api/onboarding/review` 返回 onboarding 后仍需人工审核的 draft slices。
- `POST /api/onboarding/review` 提交人工审核动作，发布通过项并重建知识索引。

SSE 事件建议：

```text
run.started
stage.started
stage.progress
stage.completed
stage.skipped
stage.failed
run.completed
run.failed
```

SSE 断开不影响后台任务。页面重新连接后先读取 run 快照，再订阅后续事件。

## 后台任务和恢复

MVP 使用进程内单任务 runner 加文件持久化，不引入外部数据库或队列。

规则：

- 同一时间最多一个 active onboarding run。
- 页面关闭不取消 run。
- HTTP 请求结束不取消 run。
- 服务重启后，如果 run 停留在 `running`：
  - 将当前阶段标记为 interrupted。
  - run 转为 failed。
  - 提供从该阶段重试。
- 已完成阶段不得无条件重复执行。
- 阶段实现应尽量幂等。
- Run 必须最终进入 `completed` 或 `failed`，不能永久保持 running。

## 配置事务

正式配置只在以下条件满足后提交：

- 草稿校验通过。
- 所有启用的 provider 测试通过。
- workspace 和 knowledge workspace 可用。
- 知识流水线完成，或明确没有知识来源需要处理。
- 关键词索引状态健康。
- 启用向量构建时，向量产物兼容。
- 最终健康检查通过。

提交要求：

- 使用临时文件写入。
- fsync/rename 或平台等价方式原子替换。
- 提交失败时保留旧配置。
- secrets 与 config 的提交顺序必须避免产生悬空 SecretRef。
- 完成后写入 onboarding completion metadata。

知识中间产物独立于正式配置事务，可以保留用于恢复和审计。

## 失败行为

- 正式配置保持不变。
- 草稿和 run 保留。
- 已完成知识产物保留。
- 提供可操作的安全错误摘要。
- 允许从 `retryableStage` 重试。
- Provider 测试失败时不提交对应配置。
- warn/error 切片不自动发布。
- 不因单个受限或不支持文件泄漏原始内容到日志。
- 无法恢复的 run 明确标记 failed，并建议创建新 run。

## UI 完成状态

Onboarding 自动执行完成后，如果存在待审核切片，Setup 先显示审核面板；审核发布并重建索引后再进入开始使用状态。

Onboarding 成功页显示：

- workspace
- knowledge root
- 已导入源文件数
- 自动发布切片数
- 待审核切片数
- 被阻止切片数
- 关键词索引状态
- 向量索引状态
- Agent/Embedding/Rerank 测试状态
- “进入 Dashboard”

进入 Dashboard 后，设置面板继续允许修改高级配置，但涉及知识重建或 provider 变化时应创建新的 onboarding/configuration run，而不是同步阻塞保存请求。

## README 重构

README 的首次启动主路径改为：

```bash
pnpm install
pnpm onboard
```

内网模式：

```bash
pnpm onboard -- --bind lan
```

日常使用：

```bash
pnpm dashboard
pnpm status
pnpm doctor
```

README 不再要求用户逐条执行 workspace、knowledge、model、embedding、rerank 命令。

原有细粒度命令继续作为高级维护和故障排查工具保留，但不属于首次启动流程。

## 测试策略

### CLI

- `onboard` 启动 Setup。
- `dashboard` 根据完成状态选择 `/` 或 `/setup`。
- `--bind loopback` 和 `--bind lan`。
- `--host` 优先级。
- `status` 在服务未运行时可用。
- 源码 pnpm script 与发布 CLI 行为一致。

### Onboarding 模块

- 草稿保存和脱敏读取。
- 配置校验。
- 执行计划和增量跳过。
- 单 active run。
- 阶段状态转换。
- 真实计数进度。
- 服务重启后的 interrupted 恢复。
- 从失败阶段重试。
- 最终配置原子提交。

### Secrets

- 文件权限。
- file/env SecretRef。
- 旧配置兼容。
- API、SSE、日志和状态不泄漏。
- 悬空 SecretRef 处理。

### 知识流水线

- 新增/变化/未变化源文件。
- 质量门禁自动发布。
- warn/error 保留审核。
- 索引脏标记和重建。
- 向量兼容时跳过。
- 阶段重试幂等。

### Gateway 和 UI

- onboarding DTO。
- 未配置跳转。
- QuickStart 和高级设置。
- SSE 事件。
- 刷新后恢复。
- 完成页。
- LAN 安全警告。

### 最低验证

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## MVP 不包含

- LAN 访问鉴权
- 用户登录和权限
- 多用户配置隔离
- 外部数据库
- 外部任务队列
- 多个 onboarding run 并行
- 自动 reset 或数据删除
- 完整 npm 发布流程
- 对所有模型厂商的预设

## 验收标准

1. 新用户执行 `pnpm onboard` 后可以只通过 Dashboard 完成首次配置。
2. 初始化完成后无需再执行 `dev`，服务直接进入日常 Dashboard。
3. 项目初始化、模型测试、知识处理、索引和健康检查由一次提交触发。
4. 页面刷新或关闭后，run 继续执行且进度可恢复。
5. 失败后可以从失败阶段重试。
6. 正式配置不会被失败 run 的半成品覆盖。
7. API Key 不出现在 config、API、SSE、日志和 run 文件中。
8. 质量门禁通过的切片自动发布，warn/error 切片保留审核。
9. 重复 onboard 不删除历史数据，不重复处理未变化源文件。
10. `--bind lan` 绑定 `0.0.0.0` 并显示可信内网警告。
11. `onboard/dashboard/doctor/status` 的源码态和发布态语义一致。
12. `pnpm lint`、`pnpm typecheck`、`pnpm build` 和 `pnpm test` 通过。
