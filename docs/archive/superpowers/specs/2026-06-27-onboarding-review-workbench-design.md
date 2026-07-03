# Onboarding Review Workbench Design

## 状态

用户已确认方案 B：服务端分页 + 多选批量动作 + 可解释警告。

## 背景

Setup 审核页当前把所有待审核切片一次性渲染出来，并且只提供“接受警告并发布”。后端已经支持按 `ids` 提交审核动作，但 UI 没有暴露多选、退回修改或不发布。质量问题也只显示原始 warn/error 代码和英文消息，用户无法判断为什么不对、缺了什么信息、应该怎么处理。

## 目标

- 审核列表按页加载，Setup 页面不再一次性渲染全部数据。
- 支持多选后对选中切片执行发布、退回修改、不发布。
- 保留 error/blocked 不可发布的门禁，只允许 warn 切片被人工接受发布。
- 每个质量问题显示中文原因、影响、建议动作和缺失信息。
- Gateway 只负责 query/body DTO 解析，审核选择、发布、索引仍由 `src/onboarding/service.ts` 和 `src/knowledge/` 负责。

## 非目标

- 不引入登录、权限、外部任务队列或数据库。
- 不改变知识 draft/publish artifact shape。
- 不修改正式知识发布规则：未审核或 blocked 切片不能进入索引。
- 不重做 Setup 页面整体视觉。

## 接口设计

`GET /api/onboarding/review` 支持可选 query：

- `offset`: 从 0 开始的偏移量，默认 0。
- `limit`: 每页数量，默认按调用方决定；Setup UI 使用 20。
- `severity`: `all | warn | error`，默认 `all`。
- `search`: 在标题、模块、id、来源、预览和 issue 文案中搜索。

返回仍是 `{ review }`，`review.items` 只包含当前页，新增 `review.page`：

```json
{
  "offset": 0,
  "limit": 20,
  "total": 157,
  "returned": 20,
  "hasMore": true,
  "severity": "all",
  "search": ""
}
```

`POST /api/onboarding/review` 继续使用现有 body：

```json
{
  "action": "accept_warnings | request_edits | reject",
  "ids": ["drf_..."],
  "notes": "人工审核备注"
}
```

后端继续拒绝对 error 切片执行 `accept_warnings` 或 `approve`。

## 数据设计

`OnboardingReviewIssue` 新增 `explanation`：

```ts
{
  reason: string;
  impact: string;
  suggestion: string;
  missingInfo: string[];
}
```

解释由 onboarding 服务根据 `KnowledgeQualityIssue.code` 和现有 `details` 生成。前端只展示，不在 UI 里推断业务原因。

## UI 设计

审核面板包含：

- 顶部摘要：待审核、blocked、当前页、总数。
- 筛选控件：严重级别、搜索、刷新。
- 多选控件：选择当前页、清空选择。
- 当前页列表：checkbox、标题、来源、预览、issue 原因/影响/建议/缺失信息。
- 操作按钮：发布选中、退回修改、不发布选中。

发布选中仅对 warn 项启用；如果选择中包含 error，UI 提示 blocked 不能发布，后端仍二次防护。

## 测试策略

- 服务测试覆盖分页、筛选、搜索、issue 中文解释和选中发布。
- HTTP 测试覆盖 query 参数传入服务。
- UI 字符串测试覆盖分页、多选和三个动作按钮。
- 按仓库规则运行 `pnpm typecheck` 和相关测试；如运行时/gateway/UI 行为变更，最终运行 `pnpm test`。
