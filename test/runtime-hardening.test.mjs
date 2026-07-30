import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { CaseRuntimeEventRecorder } from '../dist/runtime/event-recorder.js';
import { attachKnowledgeCodeEscalationContext, glossaryTermsFromDocuments } from '../dist/runtime/knowledge-diagnosis.js';
import { planDeepQuery } from '../dist/runtime/deep-query-planner.js';
import { renderReviewedResultForTest as ruleBasedReviewAndFormat } from './helpers/render-reviewed-result.mjs';
import { buildLogBlocks } from '../dist/observability/log-blocks.js';

function recorderFixture() {
  const caseSession = {
    id: 'case_hardening',
    userPersona: 'operations',
    logs: [],
  };
  const repository = {
    addLogEvent(target, event) {
      const stored = {
        id: `log_${target.logs.length + 1}`,
        createdAt: new Date(0).toISOString(),
        ...event,
      };
      target.logs.push(stored);
      return stored;
    },
  };
  return { recorder: new CaseRuntimeEventRecorder(repository), caseSession };
}

test('model preflight raw output and candidate text are not persisted', () => {
  const { recorder, caseSession } = recorderFixture();
  const raw = `Let me analyze the situation carefully. apiKey: sk-secret-123 ${'chain-of-thought '.repeat(240)}`;

  const event = recorder.modelPreflightResult(caseSession, raw, {
    action: 'dispatch',
    reason: 'workspace contains enough searchable signal',
    missingInfo: [],
  });

  assert.equal('raw' in event.detail, false);
  assert.equal('parsed' in event.detail, false);
  assert.deepEqual(event.detail, { action: 'dispatch', missingInfoCount: 0 });
});

test('worker raw output stdout is redacted before persistence', () => {
  const { recorder, caseSession } = recorderFixture();

  recorder.workerTrace(caseSession, {
    command: 'claude --print',
    cwd: '/tmp/workspace',
    stdout: 'diagnostic ok apiKey: sk-worker-secret-123',
    stderr: '',
    exitCode: 0,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
  });

  const rawOutput = caseSession.logs.find((event) => event.phase === 'raw_output');
  assert.ok(rawOutput);
  assert.doesNotMatch(rawOutput.detail.stdout, /sk-worker-secret-123/);
  assert.match(rawOutput.detail.stdout, /\[REDACTED\]/);
});

test('knowledge answer and review log events reference evidence ids instead of duplicating evidence objects', () => {
  const { recorder, caseSession } = recorderFixture();
  const result = {
    status: 'concluded',
    summary: '知识证据足够',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_knowledge_1',
        kind: 'knowledge',
        source: 'knowledge/faq/ai-companion/rule.md',
        summary: 'AI伴学助手规则',
        confidence: 'high',
      },
    ],
    claims: [{ type: 'fact', text: '规则已发布。', evidenceIds: ['ev_knowledge_1'] }],
    recommendedNextAction: 'final_answer',
  };
  const run = { id: 'run_1' };

  const selected = recorder.knowledgeAnswerSelected(caseSession, result);
  const review = recorder.evidenceReviewStarted(caseSession, run, result);

  assert.deepEqual(selected.detail.evidenceIds, ['ev_knowledge_1']);
  assert.equal('evidence' in selected.detail, false);
  assert.deepEqual(review.detail.evidenceIds, ['ev_knowledge_1']);
  assert.equal(JSON.stringify(review.detail).includes('knowledge/faq/ai-companion/rule.md'), false);
});

test('evidence judge result log keeps a snapshot when judge is later updated', () => {
  const { recorder, caseSession } = recorderFixture();
  const judge = {
    answerable: true,
    confidence: 'high',
    need_code_escalation: false,
    reason: '知识证据足够。',
    evidence: ['ev_knowledge_1'],
    risks: [],
    missing_info: [],
    conflicts: [],
    recommended_next_action: 'final_answer',
    answer_score: 0.92,
    blockers: [],
    ambiguity: [],
  };

  const event = recorder.evidenceJudgeResult(caseSession, judge);
  judge.answerable = false;
  judge.need_code_escalation = true;
  judge.blockers.push('question_not_answered');
  judge.reason = '后续覆盖判断改写。';

  assert.equal(event.detail.answerable, true);
  assert.equal(event.detail.need_code_escalation, false);
  assert.deepEqual(event.detail.blockers, []);
  assert.equal(event.detail.reason, '知识证据足够。');
});

test('full knowledge evidence object is persisted only by knowledge search result', () => {
  const { recorder, caseSession } = recorderFixture();
  const sourcePath = 'knowledge/faq/ai-companion/rule.md';
  const evidencePack = {
    query: {
      normalized_question: 'AI伴学助手规则是什么',
      module_candidates: ['ai-companion'],
      intent_candidates: [],
      keywords: ['AI伴学助手', '规则'],
    },
    results: [
      {
        evidence_id: 'ev_kb_ai_companion_rule',
        document_id: 'doc_ai_companion_rule',
        parent_id: 'doc_ai_companion_rule',
        chunk_id: 'chk_ai_companion_rule',
        source: sourcePath,
        title: 'AI伴学助手规则',
        type: 'faq',
        module: 'ai-companion',
        intent: 'explain',
        source_type: 'faq',
        confidence: 'high',
        status: 'active',
        visibility: 'support',
        matched_terms: ['AI伴学助手', '规则'],
        summary: 'AI伴学助手规则',
        excerpt: '规则正文',
        score: 1,
      },
    ],
    coverage: { searched_files: 1, matched_files: 1, filtered_out: [] },
  };
  const result = {
    status: 'concluded',
    summary: '知识证据足够',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_kb_ai_companion_rule',
        kind: 'knowledge',
        source: sourcePath,
        summary: 'AI伴学助手规则',
        confidence: 'high',
      },
    ],
    claims: [{ type: 'fact', text: '规则已发布。', evidenceIds: ['ev_kb_ai_companion_rule'] }],
    recommendedNextAction: 'final_answer',
  };
  const request = {
    caseId: caseSession.id,
    runId: 'run_1',
    workspaceId: 'current',
    userGoal: 'AI伴学助手规则是什么',
    knownFacts: [],
    unknowns: [],
    constraints: [],
    allowedMcpToolIds: [],
    context: {
      knowledge: {
        evidence: [{ id: 'ev_kb_ai_companion_rule', source: sourcePath }],
      },
    },
  };

  recorder.knowledgeSearchResult(caseSession, evidencePack);
  recorder.preflightDispatch(caseSession, request);
  recorder.diagnosticRequestCreated(caseSession, request);
  recorder.evidenceReviewStarted(caseSession, { id: 'run_1' }, result);
  recorder.knowledgeAnswerSelected(caseSession, result);
  recorder.finalReplyCreated(caseSession, '最终回答', 'final');

  const occurrences = JSON.stringify(caseSession.logs).match(new RegExp(sourcePath, 'g')) ?? [];
  assert.equal(occurrences.length, 1);
});

test('log blocks resolve evidence ids from the knowledge search dictionary', () => {
  const { recorder, caseSession } = recorderFixture();
  const sourcePath = 'knowledge/faq/ai-companion/rule.md';
  recorder.knowledgeSearchResult(caseSession, {
    query: {
      normalized_question: 'AI伴学助手规则是什么',
      module_candidates: ['ai-companion'],
      intent_candidates: [],
      keywords: ['AI伴学助手', '规则'],
    },
    results: [
      {
        evidence_id: 'ev_kb_ai_companion_rule',
        document_id: 'doc_ai_companion_rule',
        parent_id: 'doc_ai_companion_rule',
        source: sourcePath,
        title: 'AI伴学助手规则',
        type: 'faq',
        module: 'ai-companion',
        intent: 'explain',
        source_type: 'faq',
        confidence: 'high',
        status: 'active',
        visibility: 'support',
        matched_terms: ['AI伴学助手', '规则'],
        summary: 'AI伴学助手规则',
        excerpt: '规则正文',
        score: 1,
      },
    ],
    coverage: { searched_files: 1, matched_files: 1, filtered_out: [] },
  });
  recorder.knowledgeAnswerSelected(caseSession, {
    status: 'concluded',
    summary: '知识证据足够',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_kb_ai_companion_rule',
        kind: 'knowledge',
        source: sourcePath,
        summary: 'AI伴学助手规则',
        confidence: 'high',
      },
    ],
    claims: [{ type: 'fact', text: '规则已发布。', evidenceIds: ['ev_kb_ai_companion_rule'] }],
    recommendedNextAction: 'final_answer',
  });

  const selected = buildLogBlocks(caseSession).find((block) => block.phase === 'knowledge_answer_selected');
  assert.ok(selected);
  assert.deepEqual(selected.detail.evidenceIds, ['ev_kb_ai_companion_rule']);
  assert.equal(selected.detail.evidence[0].source, sourcePath);
});

test('legacy case logs with embedded evidence details still render', () => {
  const blocks = buildLogBlocks({
    id: 'case_legacy',
    logs: [
      {
        id: 'log_legacy',
        createdAt: new Date(0).toISOString(),
        actor: 'agent',
        phase: 'knowledge_answer_selected',
        label: '知识直答',
        severity: 'ok',
        summary: '旧日志',
        detail: {
          evidence: [{ id: 'ev_old', source: 'knowledge/legacy.md' }],
        },
      },
    ],
  });

  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].detail.evidence, [{ id: 'ev_old', source: 'knowledge/legacy.md' }]);
});

test('unknown runtime event phases use a fallback log label', () => {
  const blocks = buildLogBlocks({
    id: 'case_unknown_phase',
    logs: [
      {
        id: 'log_unknown',
        createdAt: new Date(0).toISOString(),
        actor: 'system',
        phase: 'new_future_phase',
        severity: 'ok',
        summary: '未来事件',
      },
    ],
  });

  assert.equal(blocks[0].label, '执行过程');
});

test('deep query planning uses module and project type signals while filtering anchor noise', () => {
  const route = {
    normalizedQuestion: '营销主题中关闭分类挂件在哪里',
    moduleCandidates: ['marketing-theme'],
    intentCandidates: [],
    keywords: ['营销', '销主', '主题', '题中', '关闭'],
    sourceTypes: [],
    codeEscalationSignals: [],
    risks: [],
  };
  const evidencePack = { results: [] };
  const judge = {
    answerable: false,
    reason: '需要查当前实现',
    blockers: ['implementation_detail'],
    need_code_escalation: true,
    recommended_next_action: 'dispatch_code_diagnosis',
  };

  const plan = planDeepQuery({
    question: '营销主题中关闭分类挂件在哪里',
    route,
    evidencePack,
    judge,
    projectType: 'symfony',
    glossaryTerms: ['销主'],
  });

  assert.deepEqual(plan.artifactTargets, ['template', 'widget', 'config']);
  assert.equal(plan.likelyPaths.includes('web/themes/**/*.twig'), true);
  assert.equal(plan.likelyPaths.some((path) => path === 'src/**/*service*'), false);
  assert.equal(plan.anchorTerms.includes('题中'), false);
  assert.equal(plan.anchorTerms.includes('销主'), true);
  assert.match(plan.anchorTerms.join(','), /营销|主题|关闭/);
});

test('glossary knowledge documents feed the deep query anchor whitelist', () => {
  const terms = glossaryTermsFromDocuments([
    {
      frontmatter: {
        id: 'kb_glossary_xiaozhu',
        title: '销主',
        type: 'glossary_term',
        module: 'marketing-theme',
        intent: 'definition',
        source_type: 'glossary',
        confidence: 'high',
        status: 'active',
        visibility: 'internal',
        product_versions: [],
        related_terms: ['营销主题'],
        related_repos: [],
        last_verified_at: '2999-01-01',
        owner: 'qa',
      },
      body: '销主是营销主题中的业务简称。',
      headings: ['业务简称'],
      path: '/tmp/knowledge/glossary/terms/xiaozhu.md',
      relativePath: 'glossary/terms/xiaozhu.md',
    },
  ]);

  assert.deepEqual(terms, ['销主', '营销主题', '业务简称']);
});

test('deep query planning falls back to regex targets when modules are empty', () => {
  const route = {
    normalizedQuestion: '定时任务调用 /api/orders 返回 500',
    moduleCandidates: [],
    intentCandidates: [],
    keywords: ['定时任务', '订单'],
    sourceTypes: [],
    codeEscalationSignals: ['/api/orders', '500'],
    risks: [],
  };
  const evidencePack = { results: [] };
  const judge = {
    answerable: false,
    reason: '需要查当前实现',
    blockers: ['implementation_detail'],
    need_code_escalation: true,
    recommended_next_action: 'dispatch_code_diagnosis',
  };

  const plan = planDeepQuery({
    question: route.normalizedQuestion,
    route,
    evidencePack,
    judge,
  });

  assert.equal(plan.projectType, 'generic');
  assert.equal(plan.artifactTargets.includes('scheduler'), true);
  assert.equal(plan.artifactTargets.includes('route'), true);
  assert.equal(plan.likelyPaths.includes('src/**/scheduler*'), true);
});

test('deep query planning uses rag missing elements as anchor terms', () => {
  const route = {
    normalizedQuestion: '学员数据统计缺少6月份数据，如何补上，有没有现成命令行',
    moduleCandidates: ['edusoho-training'],
    intentCandidates: ['how_to'],
    keywords: ['学员数据统计', '定时任务'],
    sourceTypes: [],
    codeEscalationSignals: [],
    risks: [],
  };
  const evidencePack = {
    results: [
      {
        evidence_id: 'ev_student_statistics_context',
        matched_terms: ['学员数据统计', '定时任务'],
      },
    ],
  };
  const judge = {
    answerable: false,
    reason: '知识库只覆盖统计来源，缺少补跑方式。',
    blockers: ['question_not_answered'],
    need_code_escalation: true,
    recommended_next_action: 'dispatch_code_diagnosis',
  };

  const plan = planDeepQuery({
    question: route.normalizedQuestion,
    route,
    evidencePack,
    judge,
    projectType: 'symfony',
    answerability: {
      answerability: 'partial',
      selectedEvidenceIds: ['ev_student_statistics_context'],
      coveredClaims: [
        {
          id: 'rag_claim_generation_source',
          text: '知识库确认学员数据统计由定时任务生成。',
          evidenceIds: ['ev_student_statistics_context'],
          coveredRequirementIds: ['generation_source'],
          usefulness: '作为补数据背景。',
        },
      ],
      missingElements: ['现成补跑命令', '6月份范围参数', '执行后验证方式'],
      shouldEscalate: true,
      escalationFocus: '查找学员数据统计回补命令、月份参数和验证方式。',
      reason: '只覆盖生成背景。',
    },
  });

  const anchors = plan.anchorTerms.join('\n');
  assert.match(anchors, /现成补跑命令/);
  assert.match(anchors, /回补命令/);
  assert.match(anchors, /月份参数/);
});

test('runtime event phases are documented in development standards', () => {
  const source = readFileSync(new URL('../src/runtime/event-recorder.ts', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../docs/standards/development.md', import.meta.url), 'utf8');
  const phases = Array.from(source.matchAll(/phase:\s*'([^']+)'/g), (match) => match[1])
    .filter((phase, index, all) => all.indexOf(phase) === index)
    .sort();
  const missing = phases.filter((phase) => !docs.includes(`\`${phase}\``));

  assert.deepEqual(missing, []);
});

test('knowledge project type config is attached to deep query context', () => {
  const config = defaultConfig();
  config.knowledge.projectType = 'symfony';
  const request = {
    caseId: 'case_project_type',
    runId: 'run_project_type',
    workspaceId: 'current',
    userGoal: '营销主题分类挂件在哪里关闭',
    knownFacts: [],
    unknowns: [],
    constraints: ['read-only diagnosis'],
    allowedMcpToolIds: [],
  };
  const route = {
    normalizedQuestion: request.userGoal,
    moduleCandidates: ['marketing-theme'],
    intentCandidates: [],
    keywords: ['营销', '主题', '挂件'],
    sourceTypes: [],
    codeEscalationSignals: [],
    risks: [],
  };
  const evidencePack = { results: [] };
  const judge = {
    answerable: false,
    confidence: 'low',
    need_code_escalation: true,
    reason: '需要查当前实现',
    evidence: [],
    risks: [],
    missing_info: [],
    conflicts: [],
    recommended_next_action: 'dispatch_code_diagnosis',
    answer_score: 0,
    blockers: ['implementation_detail'],
  };

  attachKnowledgeCodeEscalationContext({
    request,
    question: request.userGoal,
    route,
    evidencePack,
    judge,
    projectType: config.knowledge.projectType,
  });

  assert.equal(request.context.deepQuery.projectType, 'symfony');
  assert.equal(request.context.deepQuery.likelyPaths.includes('web/themes/**/*.twig'), true);
  assert.equal(request.context.deepQuery.likelyPaths.includes('src/**/*service*'), false);
});

test('knowledge code escalation context preserves partial rag answerability', () => {
  const request = {
    caseId: 'case_rag_partial',
    runId: 'run_rag_partial',
    workspaceId: 'current',
    userGoal: '学员数据统计缺少6月份数据，如何补上，有没有现成命令行',
    knownFacts: [],
    unknowns: [],
    constraints: ['read-only diagnosis'],
    allowedMcpToolIds: [],
  };
  const route = {
    normalizedQuestion: request.userGoal,
    moduleCandidates: ['edusoho-training'],
    intentCandidates: ['how_to'],
    keywords: ['学员数据统计', '定时任务'],
    sourceTypes: [],
    codeEscalationSignals: [],
    risks: [],
  };
  const evidencePack = {
    results: [
      {
        evidence_id: 'ev_student_statistics_context',
        source: 'knowledge/whitepapers/edusoho-training/student-statistics.md',
        source_document: 'knowledge/_sources/student-statistics.md',
        source_document_id: 'src_student_statistics',
        source_block_ids: ['blk_student_statistics'],
        section_path: ['学员管理', '用户数据统计'],
        title: '用户数据统计',
        summary: '用户数据统计用于查看学员管理中的用户统计数据。',
        answer_span: '用户数据统计由定时任务生成。',
        confidence: 'high',
        status: 'active',
        matched_terms: ['学员数据统计', '定时任务'],
      },
    ],
  };
  const judge = {
    answerable: false,
    confidence: 'low',
    need_code_escalation: true,
    reason: '知识库只覆盖统计来源，缺少补跑命令。',
    evidence: ['ev_student_statistics_context'],
    risks: [],
    missing_info: ['现成补跑命令', '月份范围参数'],
    conflicts: [],
    recommended_next_action: 'dispatch_code_diagnosis',
    answer_score: 0.48,
    blockers: ['question_not_answered'],
  };
  const answerability = {
    answerability: 'partial',
    selectedEvidenceIds: ['ev_student_statistics_context'],
    coveredClaims: [
      {
        id: 'rag_claim_generation_source',
        text: '知识库确认学员数据统计由定时任务生成。',
        evidenceIds: ['ev_student_statistics_context'],
        coveredRequirementIds: ['generation_source'],
        usefulness: '作为代码排查背景。',
      },
    ],
    missingElements: ['现成补跑命令', '月份范围参数'],
    shouldEscalate: true,
    escalationFocus: '查找学员数据统计回补命令和月份参数。',
    reason: '知识库只覆盖生成背景。',
  };

  attachKnowledgeCodeEscalationContext({
    request,
    question: request.userGoal,
    route,
    evidencePack,
    judge,
    projectType: 'symfony',
    answerability,
  });

  assert.deepEqual(request.context.knowledge.answerability, answerability);
  assert.match(request.knownFacts.join('\n'), /知识库可用结论：知识库确认学员数据统计由定时任务生成/);
  assert.match(request.constraints.join('\n'), /查找学员数据统计回补命令和月份参数/);
});

test('every persona hides internal whitepaper source paths', () => {
  const result = {
    status: 'concluded',
    summary: '证据来自 knowledge/_sources/whitepapers/ai-companion.docx',
    missingInfo: [],
    evidence: [
      {
        id: 'ev_whitepaper_source',
        kind: 'knowledge',
        source: 'knowledge/_sources/whitepapers/ai-companion.docx',
        summary: 'AI伴学助手白皮书',
        confidence: 'high',
      },
    ],
    claims: [
      {
        id: 'claim_whitepaper_source',
        type: 'fact',
        role: 'primary_answer',
        text: '规则来自 knowledge/_sources/whitepapers/ai-companion.docx 的审核资料。',
        evidenceIds: ['ev_whitepaper_source'],
        answers: ['direct_answer'],
      },
    ],
    recommendedNextAction: 'final_answer',
  };

  const operationsReply = ruleBasedReviewAndFormat(result, 'operations');
  const developerReply = ruleBasedReviewAndFormat(result, 'developer');

  assert.doesNotMatch(operationsReply, /knowledge\/_sources\/whitepapers\//);
  assert.match(operationsReply, /内部资料/);
  assert.doesNotMatch(developerReply, /knowledge\/_sources\/whitepapers\//);
  assert.match(developerReply, /内部资料/);
});
