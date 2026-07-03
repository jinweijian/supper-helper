# Evidence Coverage Judge 设计

- **日期**: 2026-06-28
- **状态**: Draft
- **背景 case**: `sessions/case_4e905fbc`（用户问"学员数据统计补数据命令行"，系统误命中"用户数据统计"并直答）
- **关联模块**: `src/runtime/`、`src/agents/`

## 1. 问题

`case_4e905fbc` 暴露 RAG 检索链路的语义缺口：

1. **BM25 召回**: bigram 分词让"学员数据统计"与"用户数据统计"共享 60% token；`section_path` 中的"学员管理"被并入 `headings` 字段（权重 3），制造"在学员管理下 = 关于学员统计"的强假信号。
2. **Rerank**: cross-encoder 计算 query↔chunk 文本相似度，不判断"证据能否回答问题"。
3. **Evidence Judge**: 评分全是字段命中计数（`matchedTermCount * 0.18 + titleMatch * 0.25 + moduleMatch * 0.15`），无"问题语义 vs 证据覆盖"匹配。本地已有 `inferAnswerRequirements`/`question_not_answered` 半成品但未 build/跑，且仅覆盖"补统计""命令行"两类规则。

**结果**: 用户问"补数据命令行"，KB 无此文档，系统命中最接近的"用户数据统计"功能说明文档，`answer_score=0.86`、`blockers=[]`、`answerable=true`，错误直答。

## 2. 目标

- 当 KB 证据**不覆盖**原问题需要的答案要素时，Judge 必须拒绝直答（`answerable=false`），强制走 `dispatch_code_diagnosis`。
- 用**模型**判断"证据是否覆盖原问题"，而非纯规则 pattern 匹配，覆盖任意问题类型。
- 仅在原本会过直答门禁的高分候选上触发，控制模型调用成本。
- 模型调用失败时降级到现有规则型 Judge，不阻断主流程。
- 不改动检索算法（BM25/rerank），本次只加固 Judge 门禁。

## 3. 方案

新增 **Evidence Coverage Agent**（`evidence-coverage`），作为 Evidence Judge 之后的独立模型辅助门禁。

### 3.1 架构定位

```
Knowledge Search
  → Evidence Judge (deterministic scoring, 现有)
    → [if answerable && top.rerankScore >= 0.7]
      → Evidence Coverage Agent (model_assisted, 新增)
        → covered: 维持 answerable=true
        → not_covered: 强制 answerable=false, blockers+=question_not_answered
        → partial: 降低 confidence, blockers+=question_not_answered
        → model failure: 降级回 Evidence Judge 原结论
```

Coverage Agent **不替换** Evidence Judge，而是叠加在它之上：Judge 先做字段/质量/置信评分，过门禁后再由 Coverage Agent 做语义覆盖校验。这样：
- Judge 的现有逻辑（stale/conflict/risk/quality 拦截）保留
- Coverage Agent 只负责"问题语义 vs 证据内容"这一维度
- 降级路径清晰：模型失败 = 回退到 Judge 原结论

### 3.2 触发条件

Coverage Agent 仅在以下条件**全部满足**时调用：

1. Evidence Judge 判定 `answerable=true`
2. `results[0].retrieval?.rerankScore >= 0.7`（或非 rerank 路径下 `titleMatch + moduleMatch` 过门禁）
3. 配置 `config.agent.useModelForEvidenceCoverage === true`（默认 true，可在 settings 关闭）

低分证据本来就不会直答，无需调用。这把模型调用限制在"原本会错误直答"的窄场景。

### 3.3 Agent 配置

`src/agents/registry.json` 新增条目：

```json
{
  "id": "evidence-coverage",
  "role": "evidence-coverage-judge",
  "stage": "evidence_coverage",
  "configPath": "evidence-coverage.md",
  "required": false,
  "mayProduceUserFacingText": false,
  "executionMode": "model_assisted",
  "summary": "证据覆盖 Agent，用模型判断知识证据是否真正覆盖原问题需要的答案要素。"
}
```

### 3.4 Agent prompt（`src/agents/evidence-coverage.md`）

核心职责：给定原问题和 top-N evidence 文本，判断证据是否覆盖问题需要的答案。

输入：
- 原问题（`question`，未经归一化的原始用户消息）
- top-N evidence 的 `title + summary + answer_span + excerpt`（N=3，控制 token）

输出 JSON：
```json
{
  "coverage": "covered" | "partial" | "not_covered",
  "missing_elements": ["补跑/重跑数据的步骤", "命令行名称或参数"],
  "reason": "证据只描述了用户数据统计的页面功能，未覆盖补数据步骤或命令行操作"
}
```

规则约束（写进 prompt）：
- 只能判断"证据是否覆盖问题"，不能新增事实
- `not_covered` 当证据只命中功能说明/页面描述，但问题问的是操作步骤/命令/实现时
- `partial` 当证据覆盖部分要素但缺少关键部分时
- `covered` 当证据直接包含问题所需答案要素时
- 不得复述证据内容，只判断覆盖关系

### 3.5 运行时集成

新增 `src/runtime/evidence-coverage-service.ts`，模式参考 `preflight-service.ts`：

```typescript
export class EvidenceCoverageService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly agentSpec: string,
  ) {}

  async evaluate(input: {
    question: string;
    evidence: KnowledgeEvidenceResult[];
  }): Promise<CoverageResult> {
    // 构造 prompt，调用 model.complete，解析 JSON
    // 失败时返回 { coverage: 'unknown', reason } 触发降级
  }
}
```

在 `knowledge-diagnosis.ts` 的 `prepareKnowledgeDiagnosis` 中，Evidence Judge 之后插入：

```typescript
const judge = judgeKnowledgeEvidence({ route, evidencePack, question });

if (judge.answerable && config.agent.useModelForEvidenceCoverage) {
  const topScore = evidencePack.results[0]?.retrieval?.rerankScore ?? 0;
  if (topScore >= 0.7) {
    const coverage = await coverageService.evaluate({ question, evidence: evidencePack.results.slice(0, 3) });
    if (coverage.coverage === 'not_covered' || coverage.coverage === 'partial') {
      // 强制覆盖 Judge 结论
      judge.answerable = false;
      judge.blockers.push('question_not_answered');
      judge.ambiguity.push(`证据未覆盖原问题：${coverage.missing_elements.join('、')}`);
      judge.recommended_next_action = 'dispatch_code_diagnosis';
      judge.confidence = 'low';
      judge.reason = coverage.reason;
    }
    events.evidenceCoverageResult(caseSession, coverage);
  }
}
```

### 3.6 事件记录

`event-recorder.ts` 新增：
- `evidenceCoverageStarted(caseSession, { question, evidenceIds })`
- `evidenceCoverageResult(caseSession, coverage)` → phase `evidence_coverage_result`
- `evidenceCoverageFailed(caseSession, message)` → phase `evidence_coverage_failed`

case JSON logs 新增对应条目，便于事后审计。

### 3.7 配置

`config.ts` 的 `agent` 段新增：

```typescript
useModelForEvidenceCoverage?: boolean;  // 默认 true
evidenceCoverageTopN?: number;          // 默认 3
```

settings UI 暴露开关，与 `useModelForPreflight` 同级。

### 3.8 降级策略

| 场景 | 行为 |
|------|------|
| `useModelForEvidenceCoverage=false` | 跳过 Coverage Agent，维持 Judge 原结论 |
| 模型调用抛错/超时 | 记录 `evidence_coverage_failed`，维持 Judge 原结论 |
| 模型返回非 JSON | 记录 `evidence_coverage_failed`，维持 Judge 原结论 |
| 模型返回 `coverage: "covered"` | 维持 Judge 原结论 |
| 模型返回 `not_covered`/`partial` | 覆盖为 `answerable=false` |

降级永远倾向"维持原流程"，不会因模型故障阻断主流程。

## 4. 模块边界合规

| 层 | 职责 | 约束 |
|----|------|------|
| `src/agents/evidence-coverage.md` | Agent prompt 与规则 | 不写 runtime 编排 |
| `src/agents/registry.json` | Agent 配对登记 | 不写检索策略 |
| `src/runtime/evidence-coverage-service.ts` | 模型调用、JSON 解析、降级 | 不写 HTTP DTO、不调 Claude worker |
| `src/runtime/knowledge-diagnosis.ts` | 编排：Judge → Coverage → 结论 | 不写 provider 协议 |
| `src/runtime/event-recorder.ts` | 事件记录结构 | 不做诊断决策 |
| `src/config.ts` | 配置项定义 | 不调 provider |

不改动 `src/retrieval/`、`src/knowledge/`、`src/providers/`、`src/gateway/`、`src/workers/`。

## 5. 测试策略

### 5.1 单元测试

- `evidence-coverage-service.test.mjs`：mock `AgentModelClient`，验证 covered/partial/not_covered/失败降级四种路径
- `evidence-judge.test.mjs`：验证 Coverage Agent 触发条件（answerable + rerankScore >= 0.7 + config 开关）

### 5.2 回归测试

- 新增 fixture：`case_4e905fbc` 的 question + evidence pack，断言 `answerable=false`、`blockers.includes('question_not_answered')`
- 保留现有 298 测试全绿

### 5.3 验证命令

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`（确保 dist 同步，避免再次出现"源码有改动但 dist 旧版本在跑"的问题）

## 6. 非目标

- 不改 BM25 分词（bigram、字段权重）
- 不改 rerank 输入或权重
- 不补 taxonomy aliases（学员↔用户区分）
- 不引入向量数据库或新 provider
- 不改 HTTP response shape
- 不改 case JSON shape（只新增 log 条目，不破坏现有结构）

这些留待后续 OpenSpec change（如 `upgrade-hybrid-parent-child-retrieval` 的后续迭代）。

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 模型判断不稳定（同问题不同次结果不同） | 降级到 Judge 原结论；prompt 约束只判断覆盖关系，不开放生成 |
| 模型调用增加延迟 | 仅高分候选触发；topN=3 控制 token；超时降级 |
| 模型误判 covered 导致漏拦 | 保留 Evidence Judge 现有 blockers（stale/conflict/quality），Coverage 是叠加非替换 |
| 模型误判 not_covered 导致误拦 | `not_covered` 走 `dispatch_code_diagnosis` 而非直接拒答，用户仍可获得代码侧诊断；`partial` 同样升级到代码诊断但保留证据供 worker 参考 |

## 8. 验收标准

1. 用 `case_4e905fbc` 的 question + evidence 重放，`answerable=false`、`recommended_next_action='dispatch_code_diagnosis'`
2. case JSON logs 包含 `evidence_coverage_result` 条目
3. 关闭 `useModelForEvidenceCoverage` 时，行为回退到当前 Judge 逻辑
4. 现有 298 测试全绿
5. `pnpm typecheck && pnpm build` 通过
