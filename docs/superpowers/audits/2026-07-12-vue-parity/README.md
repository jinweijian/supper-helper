# Vue Dashboard 迁移能力审计

## 审计范围

对照迁移前 `src/ui.ts` 与当前 Vue Dashboard，检查会话、问答、状态、答案、日志、审计面板、知识健康和配置流程。截图来自 2026-07-12 本地真实服务 `127.0.0.1:4317`。

## 步骤与健康度

1. Dashboard 与已有回答（严重回退）——回答 Markdown 原样显示；右侧进度面板平铺完整 Run JSON；状态、上下文用量、阶段轨道和证据渐进披露丢失。证据：[截图 1](01-dashboard.png)。
2. 诊断日志（严重回退）——结构化 DTO 被整体 JSON.stringify，所有日志默认平铺，缺少摘要、严重级别、时间、Agent、阶段和按需展开。证据：[截图 2](02-logs.png)。
3. 配置抽屉（严重回退）——只剩模型基础字段；Embedding、Rerank、Claude、RAG 开关、模型高级参数和 Agent 配置不可编辑；测试期间 Form 被卸载，动作反馈不可持续。证据：[截图 3](03-settings.png)。
4. 知识健康（严重回退）——默认只显示 `{}`；旧版健康卡、知识树、索引/检索/Embedding 状态、动作结果和相似知识库提示丢失。证据：[截图 4](04-knowledge-health.png)。

## 追加发现

- P0：InsightPanel 直接显示完整 Run，其中包含 DiagnosticRequest、内部约束、深查询路径、WorkerTrace command/cwd/stdout 等内部审计数据；这是信息边界回退。
- P0：设置保存只调用 model API；Embedding、Rerank、Claude 配置入口从 Vue UI 消失。
- P1：最终回答不再进行安全 Markdown/富文本渲染，也不再展示可折叠的证据卡。
- P1：上下文窗口用量、满额禁用输入、Workspace 标识、中文状态标签和 Case 阶段轨道丢失。
- P1：归档会话仍允许编辑和点击发送，直到 API 才拒绝；旧版会预先禁用输入。
- P1：处理中筛选遗漏 `ready_for_diagnosis` 与 `queued`。
- P1：知识健康不在打开会话时加载离线 local health；显式检索使用会话标题而非最新用户问题。
- P2：多 Agent 只读配置摘要入口丢失。
- P2：新建会话未携带当前 persona；依赖首次发送再纠正。

## 证据限制

- 未点击真实模型检测，避免在审计阶段触发外部付费请求；“Form 在 loading 时卸载”由当前 Vue 控制流和组件条件渲染共同确认。
- 截图不能证明完整键盘和屏幕阅读器行为，需在实现后用 Playwright 与组件测试验证。

## 修复验收记录

2026-07-12 已按能力矩阵完成恢复：

- Dashboard 只投影已审核 result，默认界面不再展示 DiagnosticRequest 或 WorkerTrace。
- 回答恢复安全富文本，问答轮询持续发布 Session，并显示阶段、耗时、心跳、估计范围和中断状态。
- 日志恢复折叠卡片、最近三条默认展开以及全部展开/收起。
- Case 恢复中文状态、阶段轨道、上下文窗口、归档保护和完整 active 筛选。
- 打开会话自动加载离线 local health；显式测试检索使用最新用户问题。
- 设置恢复模型、Embedding、Rerank、Claude 与多 Agent 摘要；检测失败和部分保存结果可见。
- Playwright 真实生产构建验证了异步 Worker、进度卡、raw trace 隔离、日志折叠、知识健康和四类设置 API。
