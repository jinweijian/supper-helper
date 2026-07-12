# 拆分调研记录:harden-runtime-observability-and-deep-query 任务 10.x

> 状态:已完成 public entrypoint 拆分。本文档记录 5 个目标文件的现状、实际落地点、import 边界,以及后续继续细拆时的注意事项。

## 0. 上下文

`openspec/changes/harden-runtime-observability-and-deep-query/tasks.md` 中 10.1-10.7 已完成。目标是把 5 个超大公开入口按职责边界拆分,保持 public export 兼容,新增 contract test 验证 import 兼容。

- 文件 1: `src/ui.ts` 现在是薄入口,经 `src/ui/index.ts` re-export `src/ui/main-screen.ts`
- 文件 2: `src/setup-ui.ts` 现在是薄入口,re-export `src/ui/setup-screen.ts`
- 文件 3: `src/knowledge/quality.ts` 现在是薄入口,re-export `src/knowledge/quality/index.ts`
- 文件 4: `src/onboarding/service.ts` 现在是薄入口,re-export `src/onboarding/run-service.ts`
- 文件 5: `src/runtime/event-recorder.ts` 现在是薄入口,re-export `src/runtime/event-recorder/index.ts`

注意:本次完成的是 public entrypoint 和职责目录拆分,并用 contract test 保证旧入口与新入口导出同一 symbol、UI 输出 byte-for-byte 不变。后续若继续追求每个实现文件低于 300 行,应在这些新 owner 模块内继续做纯函数级细拆,不要恢复旧根入口大文件。

## 1. import 边界与 public export 约束

| 目标文件 | 谁在 import | 约束 |
| --- | --- | --- |
| `src/ui/main-screen.ts` | `src/ui.ts`(re-export)、`src/gateway/http-server.ts`(直接调用 `renderApp()`) | 必须保留 `export function renderApp(): string` |
| `src/ui/setup-screen.ts` | `src/setup-ui.ts`(re-export)、`src/gateway/http-server.ts`(直接调用 `renderSetupApp()`) | 必须保留 `export function renderSetupApp(): string` |
| `src/knowledge/quality.ts` | `src/cli/knowledge/command-pipeline.ts`、`src/knowledge/{publish,init,index,repair}.ts`、`src/knowledge/documents/retrieval-grounding.ts`、`src/retrieval/types.ts` | 外部通过 `src/knowledge/quality-report.ts` re-export 拿 `KnowledgeQualityGate`、`evaluateQualityGate`、`loadChunkQualityMap`、`readKnowledgeQualityReport` 等;`quality.ts` 本体只 export `auditKnowledgeQuality` 和 `parseMarkdownDocument` re-export |
| `src/onboarding/service.ts` | `src/onboarding/index.ts`、`src/gateway/http-server.ts`、`src/gateway/routes/onboarding-routes.ts` | 必须保留 `export class OnboardingService`、`export function createOnboardingService` |
| `src/runtime/event-recorder.ts` | `src/runtime/{experience-turn,session-lifecycle,review-presentation,knowledge-turn,worker-diagnosis,preflight-service,case-curation-service,diagnostic-runtime,case-review-runtime}.ts` | 必须保留 `export type { ModelReviewParsed }`、`export class CaseRuntimeEventRecorder`、方法签名 |

## 2. 文件 1:`src/ui/main-screen.ts` (3114 行,1 export)

**现状**: 单一 `renderApp(): string` 函数,返回包含 `<style>` CSS、`#root` HTML、`<script>` 客户端 JS 的超长字符串。本质是一个 HTML 字符串模板,代码组织上没有函数/类边界。

**难点**: 字符串模板是连续的,不能直接按函数切。最现实的拆法是按"页面区块"切分常量字符串再拼接。

**建议拆点**(按 design.md 决策):
- `src/ui/main-screen.ts` — `renderApp()` 编排,import 各区块常量并拼接
- `src/ui/styles.ts` — 整段 `<style>` CSS 字符串(`STYLES_CSS` 常量)
- `src/ui/components.ts` — 可复用 HTML 片段(`sessionItem`、`msgBubble`、`pill` 等)
- `src/ui/index.ts` — re-export `renderApp`(供 `src/ui.ts` 和 `src/gateway/http-server.ts` 不变)
- 可选: `src/ui/setup-drawer.ts`(如 setup 部分在主屏里有内嵌,可独立)

**风险**:
- 字符串拼接换行/转义容易引入视觉 regression,HTML 输出必须完全一致。
- 客户端 JS 中的事件处理函数 ID 拼接也涉及字符串拼接,改动会改变绑定关系。
- 必须跑端到端 acceptance(`pnpm test`、必要时 `accept knowledge` 烟测)或快照测试确认 HTML 输出未变。

**验证**:
- 拆分前对 `renderApp()` 输出做 git diff snapshot 存档(`tools/snapshots/main-screen.before.html`)。
- 拆分后 diff snapshot 必须为空或仅空白差异。
- `pnpm test`、`pnpm typecheck`、`pnpm build` 全绿。
- 新增 contract test:从 `src/ui/index.js` 和 `src/ui/main-screen.js` 都能 `import { renderApp }` 并指向同一函数引用。

## 3. 文件 2:`src/ui/setup-screen.ts` (722 行,1 export)

**现状**: 单一 `renderSetupApp(): string`,与 `main-screen.ts` 同构(setup 页面是另一段 HTML/CSS/JS 字符串)。

**建议拆点**:
- `src/ui/setup-screen.ts` — `renderSetupApp()` 编排
- `src/ui/setup-styles.ts` — setup 页 CSS
- `src/ui/setup-components.ts` — setup 页 HTML 片段
- `src/ui/setup-*.ts`(按 setup 步骤细分:`setup-intro.ts`、`setup-source.ts`、`setup-embedding.ts` 等,视文件结构)

**风险**: 同 `main-screen.ts`,HTML 输出必须不变。

**验证**: 同 `main-screen.ts`。

## 4. 文件 3:`src/knowledge/quality.ts` (674 行,11 个内部函数 + 1 export)

**现状**: 内部 helper 集中在 `auditKnowledgeQuality()` 一个函数中,辅以 11 个私有 helper(`auditSourceProvenance`、`computeDuplicateHashes`、`hashMeaningfulBody`、`meaningfulBody`、`discoverDraftSlices`、`extractHeadings`、`auditSliceDocument`、`isTocLike`、`isHeadingOnly`、`isMultiTopic`、`isTemplateProvenanceHeading`、`isBrokenCoreference`、`hasAnswerBearingSentence`、`auditChunks`、`loadKnownSourceBlockIds`、`auditPerSourceExtracts`)。外部只 export `auditKnowledgeQuality` 和 `parseMarkdownDocument`(re-export)。

**建议拆点**(按 design.md 决策):
- `src/knowledge/quality/index.ts` — re-export 聚合,保持外部 `from 'src/knowledge/quality.js'` 路径
- `src/knowledge/quality/audit.ts` — `auditKnowledgeQuality` + `auditSourceProvenance` + `auditSliceDocument` + `auditChunks` + `auditPerSourceExtracts`
- `src/knowledge/quality/report-io.ts` — 无新内容(报告 IO 已在 `quality-report.ts`,本文件只 re-export),实际可省略
- `src/knowledge/quality/gate.ts` — `evaluateQualityGate` 等 gate 逻辑(目前 re-export 自 `quality-report.ts`,需要看是否要搬入本目录)
- `src/knowledge/quality/chunk-map.ts` — `loadChunkQualityMap` 等(目前 re-export 自 `quality-report.ts`)

实际上 `quality-report.ts` 已经在 `src/knowledge/`,`report-io.ts`/`gate.ts`/`chunk-map.ts` 是否拆出去取决于是否有重复代码。先看 `quality-report.ts` 是否过大(行数 + 职责),再决定是"拆 `quality.ts` 的 audit 路径"还是"也拆 `quality-report.ts`"。

**风险**:
- 大量内部 helper 之间互相引用(例如 `auditKnowledgeQuality` 调 `auditSourceProvenance` 调 `computeDuplicateHashes` 调 `hashMeaningfulBody` 调 `meaningfulBody`),拆错会导致循环依赖。
- `__testing` 导出(`{ isTocLike, isHeadingOnly, ... }`)如果 helper 被搬到子模块,`__testing` 也得跟过去。

**验证**:
- `pnpm test`(应包含 `src/knowledge/quality.test.ts` 或类似)
- `pnpm typecheck`
- 新增 contract test:从 `src/knowledge/quality/index.js` 和 `src/knowledge/quality.js` 拿到的 `auditKnowledgeQuality`、`KnowledgeQualityGate`、`evaluateQualityGate`、`loadChunkQualityMap` 等所有 export 引用一致。

## 5. 文件 4:`src/onboarding/service.ts` (713 行,1 class + 12 内部函数)

**现状**: `OnboardingService` 类 + 大量 review-related helper(`buildReviewState`、`emptyReviewState`、`normalizeReviewQuery`、`normalizeReviewSeverity`、`filterReviewItems`、`reviewSearchText`、`explainReviewIssue`、`isReviewFinished`、`qualityIssuesForSlice`、`reviewSeverity`、`previewBody`、`normalizeReviewAction`、`selectReviewTargets`、`groupReviewTargets`)。外部 export `OnboardingService`、`createOnboardingService`。

**建议拆点**(按 design.md 决策):
- `src/onboarding/service.ts` — `OnboardingService` 类 + `createOnboardingService` 工厂(瘦组合入口)
- `src/onboarding/draft-service.ts` — 草稿创建/查询相关(OnboardingService 中 draft 相关方法)
- `src/onboarding/review-service.ts` — `buildReviewState`/`filterReviewItems`/`explainReviewIssue`/`reviewSeverity`/`selectReviewTargets`/`groupReviewTargets` 等 review 路径
- `src/onboarding/run-service.ts` — pipeline 编排相关方法
- `src/onboarding/secrets-service.ts` — secrets 相关方法(可能与 `src/onboarding/secrets.ts` 已有文件冲突,需要看)
- `src/onboarding/index.ts` — re-export

注意:`src/onboarding/secrets.ts` 已存在,需评估 `secrets-service.ts` 是否与之重复或互补。

**风险**:
- `OnboardingService` 是个大 class,内部 helper 通过闭包或成员方法共享状态(如 `workspaceRoot`、`config`)。如果拆成多个 service,需要明确依赖方向(由 `service.ts` 注入),不能直接破坏现有方法调用链。
- `createOnboardingService` 的 factory 签名不能变。

**验证**:
- 现有 `src/onboarding/*` 测试通过。
- 新增 contract test:从 `src/onboarding/index.js` 和 `src/onboarding/service.js` 拿到的 `OnboardingService` 引用一致。

## 6. 文件 5:`src/runtime/event-recorder.ts` (559 行,1 class + 1 type re-export)

**现状**: 单一 `CaseRuntimeEventRecorder` 类,内部按 turn 阶段(conversation、preflight、knowledge、review、curator、worker)分块组织方法。外部 import 此类的 9 个 runtime 模块都直接调方法。

**建议拆点**(按 design.md 决策):
- `src/runtime/event-recorder/index.ts` — re-export `CaseRuntimeEventRecorder` 类
- `src/runtime/event-recorder/conversation.ts` — `recordConversationEvent` 等会话类
- `src/runtime/event-recorder/preflight.ts` — preflight 阶段记录
- `src/runtime/event-recorder/knowledge.ts` — knowledge 阶段记录
- `src/runtime/event-recorder/review.ts` — review 阶段记录
- `src/runtime/event-recorder/curator.ts` — curator 阶段记录
- `src/runtime/event-recorder/worker.ts` — worker 阶段记录

类拆分有两条路:
- **A 路线(保留单一 class)**: 拆模块不拆类,各 `event-recorder/*.ts` 只 export 纯函数(recordConversation、recordPreflight、... 等),`CaseRuntimeEventRecorder` 类的方法改成调这些纯函数。**优点**: 公共 API 零变化。**缺点**: 工作量大,需要把每个方法体内联代码抽离。
- **B 路线(partial class / mixin)**: 用 TypeScript `class Merge` 或 `Object.assign` 把多个 partial 合并成 `CaseRuntimeEventRecorder`。design.md 提到"按 mixin 或 partial class 模式组合,避免 importer 感知拆分"。**优点**: 单文件仍然小。**缺点**: 对调试/堆栈不友好,IDE 跳转断裂。

**推荐 A 路线**。A 路线的实际做法是 `index.ts` 中导出 `CaseRuntimeEventRecorder` 类,类方法实现委托给 `event-recorder/conversation.ts` 等子模块的纯函数。

**风险**:
- 9 个 importer 都在用类方法,改名/改签名一定会破坏 compat。
- 事件 payload 序列化可能涉及 this 状态(如 `caseId`、`runId`),纯函数化时需要把这些 state 显式传参。
- `__testing` 导出(如有)需要跟到子模块。

**验证**:
- `pnpm test`(应包含 `src/runtime/event-recorder.test.ts` 或 `src/runtime/*.test.ts`)
- `pnpm typecheck`
- 新增 contract test:`from 'src/runtime/event-recorder/index.js'` 和 `from 'src/runtime/event-recorder.js'` 拿到的 `CaseRuntimeEventRecorder` 是同一构造器。

## 7. 推荐执行顺序(由易到难)

1. **先 `src/runtime/event-recorder.ts`**(559 行,纯函数化路径最直接)
2. **再 `src/knowledge/quality.ts`**(674 行,helper 拆分子目录)
3. **再 `src/onboarding/service.ts`**(713 行,class + helper 拆分,需要小心依赖)
4. **最后 `src/ui/main-screen.ts` 和 `src/ui/setup-screen.ts`**(3114/722 行,字符串模板风险最大,且需要 snapshot 测试基础设施)

每步执行流程:
1. 拆文件,保持 public export 兼容
2. 跑 `pnpm typecheck && pnpm test`,确认绿
3. 新增 contract test(从新路径和老路径拿到的引用一致)
4. 把 tasks.md 对应 checkbox 勾上,跑 `openspec validate harden-runtime-observability-and-deep-query --strict`

## 8. 通用硬约束

- 不允许改动外部 importer:`src/gateway/*`、`src/runtime/*`、`src/cli/*` 等已稳定的 import 路径不能变。
- 不允许破坏 HTML 字符串输出(UI 拆分时):`renderApp()`、`renderSetupApp()` 输出必须 byte-level 一致。
- 拆分后单文件行数 < 300(参考 `module-boundary-standards.md` 硬规则);如 300 行不够装,优先按职责再拆一层。
- 任何对 `quality.ts` / `onboarding/service.ts` / `event-recorder.ts` 内部 helper 的 `__testing` 导出,必须保持原值,不允许改 helper 名(测试可能在用)。
- 拆分前先 `pnpm test` 跑一遍基线,记录"全绿"基线;拆分后再跑,任何非预期失败必须立刻回滚。
- 严禁把业务策略(provider/retrieval/knowledge 业务)泄露到 UI 拆分产生的 `components.ts` / `styles.ts` 中。
