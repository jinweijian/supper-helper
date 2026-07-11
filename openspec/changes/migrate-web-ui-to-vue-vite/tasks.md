## 1. 构建与契约基线

- [x] 1.1 先冻结现有页面路由、HTTP DTO、关键交互和 render symbol 失败/兼容测试。**验收目标：** 新 UI 必须满足行为合同，但不要求 HTML 字节相同。**红灯：** 新 Vite 产物尚不存在，production asset test 失败。**绿灯：** 基线测试能区分旧内联与新构建入口。**完成证据：** 记录冻结的 route/DTO/interaction 清单。
- [x] 1.2 配置 Node>=20.19、Vue/Vite/Vitest/Playwright 和双构建输出。**验收目标：** `pnpm build` 同时生成 `dist/public` 两个 entry 和 server JS；低版本 Node doctor 明确失败。**绿灯：** build contract 与 typecheck 通过。**完成证据：** 记录锁定版本、官方 URL/日期、产物 manifest。

## 2. Dashboard 真实组件迁移

- [x] 2.1 先写 session/chat/polling/router/logs/settings/knowledge composable 的 Vitest 失败测试。**验收目标：** 状态和 API 调用可独立验证，不依赖内联全局函数。**红灯：** `pnpm test:web` 因组件不存在失败。**绿灯：** 单元测试通过。**完成证据：** 记录每个 composable 的输入输出和覆盖场景。
- [x] 2.2 迁移 Dashboard 组件和共享 session route。**验收目标：** 创建/切换/归档/删除会话、异步发送、恢复轮询、日志、设置和 knowledge actions 走现有 API。**真实验收：** Playwright 使用编译后的 Node server，不 mount mock app。**绿灯：** Dashboard smoke 通过。**完成证据：** 记录真实 HTTP 请求序列和 URL 变化。

## 3. Setup 与可访问性

- [x] 3.1 先写 Setup draft/provider/path/review/SSE/retry 和 drawer/dialog 键盘失败测试。**验收目标：** Escape、初始焦点、焦点恢复、错误 banner 均可观察。**绿灯：** Vitest 组件测试通过。**完成证据：** 记录键盘场景和 ARIA/focus 断言。
- [x] 3.2 迁移 Setup，删除 noop/占位动作并完成小幅样式整理。**验收目标：** onboarding HTTP+SSE 全流程通过，信息架构/核心文案保持。**真实验收：** Playwright 完成保存 draft、validate、start、progress、review、retry。**完成证据：** 记录最终截图路径或结构化可见文本断言，不以视觉主观判断代替测试。

## 4. Gateway 静态服务与旧实现移除

- [x] 4.1 实现安全静态文件服务和窄 render 兼容入口，随后删除内联 giant UI 与 marker 文件。**验收目标：** `/`、`/sessions/:id`、`/setup` 直接刷新成功，asset traversal 失败，旧 symbols 仍可 import。**红灯：** 先写 asset traversal/direct reload 失败测试。**绿灯：** HTTP/UI compatibility tests 通过。**完成证据：** 记录真实响应 content-type、cache policy 和入口路径。
- [x] 4.2 运行 `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:web && pnpm test:e2e`。**验收目标：** Chromium smoke 覆盖计划列出的完整工作流且无 retry/skip。**完成证据：** 记录各 suite 数量、耗时、失败重试为零；Playwright trace 仅在失败时保存并检查敏感信息。

## 5. 回头重新思考 / Anti-Fake-Complete Audit

- [x] 5.1 从浏览器 direct URL 开始追踪构建产物、Gateway、Vue Router、composable、真实 API、状态更新与焦点恢复，检查是否仍有旧内联代码或 marker 被生产使用。**完成条件：** 主动断开 API、刷新 active session、触发 SSE 错误、键盘关闭 drawer；评估 Vue/Vite 引入是否合理、组件边界是否过度或不足；发现问题必须更新 artifact 并修复，implementation-notes 写明结论。
