# Implementation Evidence

## Dependency and Build Record

- 2026-07-11 锁定并安装：Vue `3.5.39`、Vue Router `4.6.4`、Vite `8.1.4`、Vitest `4.1.10`、Playwright `1.61.1`、Vue Test Utils `2.4.11`、vue-tsc `3.3.7`。Vite 8 Node 要求依据 design 中记录的官方页面 `https://vite.dev/blog/announcing-vite8`（访问日期 2026-07-11）。
- `engines.node` 提升到 `>=20.19.0`；`scripts/check-node-version.mjs` 在 build/doctor 前明确拒绝 20.18，并由 `test/web-build-contract.test.mjs` 验证 20.18.3/20.19.0/22.0.0 边界。
- `pnpm build` 真实产物：`dist/public/index.html`、`dist/public/setup/index.html`、哈希 dashboard/setup JS、共享 JS、共享 CSS、Setup CSS，以及 `dist/**/*.js` 服务端构建。最终一次 manifest 中 Dashboard JS 42.29 kB（gzip 15.84 kB），Setup JS 13.15 kB（gzip 4.95 kB）。

## Task Evidence

- 1.1 红灯：`node --test test/web-build-contract.test.mjs` 初次 2/2 失败，原因分别是 `dist/public` 不存在、Node engine 仍为 20.0。冻结合同包括 `/`、`/sessions/:id`、`/setup`，现有 Session/Chat/Logs/Settings/Knowledge/Onboarding DTO，以及 `renderApp`/`renderSetupApp` import；HTML 字节级合同移除。
- 1.2 绿灯：`pnpm build` 生成两个 entry 与哈希资源；`pnpm typecheck` 同时运行 `tsc` 与 `vue-tsc`。`test/web-build-contract.test.mjs` 5/5 通过。
- 2.1 红灯：第一次 `pnpm test:web` 因 `use-chat` 等模块不存在失败。绿灯：4 个 Vitest 文件、11 个测试覆盖 session direct route/history、chat reply-to polling/恢复轮询、logs 按需加载、settings load/test/save、knowledge 错误保留、Setup draft/validate/run/retry/SSE 断连，以及 drawer/path dialog 键盘和焦点。
- 2.2 真实浏览器请求序列经 Playwright 记录并断言包含 `POST /api/sessions`、`POST /api/chat`、`GET /api/session`、`GET /api/logs`、`GET /api/settings`、`POST /api/settings/model`。创建会话后 URL 变为 `/sessions/case_*`，直接 reload 后仍加载同一 Case；回复经真实 Runtime/Gateway 轮询出现。
- 3.1 可访问性断言：drawer/path dialog 打开后关闭按钮获得初始焦点；Escape 关闭；关闭后焦点回到“日志”“配置”或“浏览”按钮。API/SSE 错误进入可见 banner，不显示原始事件 payload。
- 3.2 Setup Playwright 通过真实 Node HTTP 保存 draft、validate、start、SSE failed progress、显示 review、发布选中项、retry 至 completed；结构化可见文本断言包括 QuickStart、测试知识切片、failed/completed 与进入 Dashboard。无 noop/占位按钮保留。
- 4.1 红灯由缺失 production assets 与旧 server-render HTML 合同触发。绿灯：Gateway 仅从 `dist/public` 响应；`readPublicAsset` 只接受 `/assets/`、执行 decode + resolved containment，拒绝明文及编码 traversal；HTML 为 `no-cache`，哈希资源为 `public, max-age=31536000, immutable`，JS MIME 为 `text/javascript; charset=utf-8`，并设置 `nosniff`。旧 render symbols 读取构建 entry。
- 4.2 最终闸门同一工作树连续通过：`pnpm lint` 通过；`pnpm typecheck` 通过；`pnpm build` 通过；`pnpm test` 372/372；`pnpm test:web` 11/11；`pnpm test:e2e` Chromium 2/2。Playwright retries=0、无 skip；成功运行不保留 trace，只有失败时 `retain-on-failure`。
- 隔离 staged-tree 验证：从 `git write-tree` 生成 detached 临时 worktree，只包含 HEAD 与本 change 暂存内容；`node --test test/*.test.mjs` 369/369、`pnpm test:web` 11/11、`pnpm test:e2e` 2/2，通过后移除临时 worktree。当前工作树多出的 3 项来自未暂存的后续 owner-split 基线，不被本提交冒领。

## Anti-Fake-Complete Review

- 从 direct URL 追踪：Gateway `renderApp`/`renderSetupApp` 读取 `dist/public` shell，浏览器加载哈希 Vue asset，Vue Router 解析 `/sessions/:id`，composable 调用真实 Gateway API，响应更新 Vue 状态；E2E 未 mount mock Vue app。测试服务只注入可控 worker/onboarding 外部边界，HTTP、Runtime、Case repository、静态服务和浏览器均为生产实现。
- 主动故障：knowledge/API 500 保留旧 health 并显示 safe error；SSE `onerror` 显示中断提示；active session direct reload 会按最新 userMessageId 恢复 polling；路径 traversal 在生产 asset reader 被拒绝；Escape 即使保存导致焦点元素重建也由 document-level handler 正确关闭并恢复 opener。
- 审计发现并修复真实竞态：配置抽屉最初在 GET settings 完成前允许编辑，异步 hydration 会覆盖输入。现改为加载期不渲染表单，数据到达后才开放编辑，并由真实 E2E 保存断言保护。
- `src/ui` 仅保留 3 个窄兼容文件，旧 giant/components/styles marker 已删除；`rg 'onclick=|marker' src/ui web/src` 无结果。23 个前端 TS/Vue 文件最大 132 行，没有 owner 超 300 行。
- 边界结论：Gateway 只负责静态 MIME/containment/响应；Vue composables 只拥有浏览器状态和 API client；Runtime、Agents、Sessions、Workers、Observability 合同未搬入前端。当前组件粒度足以独立测试且未出现一字段一组件的过度拆分。
- 设计约束复盘：这是保留式 Dashboard 迁移（Variance 3 / Motion 2 / Density 6），保留 IA 和核心中文文案，使用系统字体、单一绿色 accent、统一圆角、light/dark tokens、reduced-motion、完整 loading/empty/error/focus 状态；没有引入营销页动画、假截图或视觉重设计。
