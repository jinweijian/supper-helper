## Context

当前两套页面以内联模板承载 HTML、重复 CSS、状态、API client 和交互。所谓 components/styles 文件只是 marker，无法独立测试或复用。

## Goals / Non-Goals

**Goals:**

- 建立 Vue 3/Vite 的真实组件边界和生产静态构建。
- 保持页面 URL、HTTP DTO、主要布局和文案。
- 用 Vitest 与 Playwright 保护浏览器行为。

**Non-Goals:**

- 不全面重设计，不引入 SSR，不改变 Gateway 业务职责。

## Decisions

1. 新建 `web/` 多页 Vite 应用：Dashboard entry 使用 Vue Router history 模式，Setup 为独立 entry。版本锁定 Vue 3.5 minor、Vue Router 4、Vite 8.1 minor、Vitest 4、Playwright 1；Vite 8 Node 要求来源 `https://vite.dev/blog/announcing-vite8`，访问日期 2026-07-11。
2. Node engines 提升为 `>=20.19.0`。构建顺序：清理 dist → Vite 输出 `dist/public` → TypeScript 输出 `dist`。
3. Dashboard 拆为 session/chat/progress/logs/settings/knowledge 组件和 composables；Setup 拆为 draft/provider/path/review/run-progress。共享 API DTO 使用环境中立 type-only contract。
4. Gateway 只负责 MIME、安全路径和静态文件响应；app shell route 读取构建产物。旧 `renderApp`/`renderSetupApp` 保留为窄文件读取兼容入口。
5. 移除 noop/占位动作；统一 error banner；drawer/dialog 支持 Escape、初始焦点、关闭后恢复焦点。视觉只清理重复样式和明显交互问题。

## Risks / Trade-offs

- [一次迁移导致行为回归] → 先冻结 HTTP/路由/E2E 场景，再逐页替换；旧内联实现保留到 Playwright 绿后删除。
- [构建产物缺失导致服务启动失败] → startServer 返回明确配置错误，build contract 必须检查两个 HTML entry 和 hashed assets。
- [浏览器测试不稳定] → 使用本地 fake worker/provider、固定端口和事件条件等待，禁止任意 sleep。

## Migration Plan

先引入并行 web 构建和静态路由，再迁移 Dashboard、Setup，最后删除内联实现和 marker 测试。HTTP API 和 Case 数据无需迁移。

## Open Questions

无。已确认 Vue 3、Vite 8、Node 20.19、Playwright 和小幅体验整理。
