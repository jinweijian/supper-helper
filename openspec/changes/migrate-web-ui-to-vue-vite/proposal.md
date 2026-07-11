## Why

当前 Dashboard/Setup 由数千行内联 HTML/CSS/JavaScript 组成，既难以真实拆分，也无法用组件和浏览器测试保护交互。需要迁移到可构建、可测试的 Vue 前端，同时保持现有产品入口和 HTTP 合同。

## What Changes

- 新建 Vue 3 + Vite 多页前端，保留 `/`、`/sessions/:id` 和 `/setup`。
- 将会话、聊天、日志、设置、知识健康和 Setup 拆成组件与 composables。
- Gateway 从 `dist/public` 服务构建产物，并保留旧 render 符号兼容。
- 增加 Vitest 与 Playwright 真实浏览器验收。
- 提升 Node 最低版本到 20.19，移除无功能占位动作并补齐键盘/焦点行为。

## Capabilities

### New Capabilities

- `vue-web-application`: Vue/Vite 构建、静态服务、会话路由和浏览器交互合同。

### Modified Capabilities

- `runtime-behavior-compatibility`: 页面入口和 HTTP DTO 保持兼容，HTML 不再要求字节级一致。

## Impact

新增 `web/`、Vite/Vue/Vitest/Playwright 依赖与构建脚本；Gateway 静态资源路由和 UI 兼容入口调整；不做全面视觉或信息架构重设计。
