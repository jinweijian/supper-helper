import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { routeKnowledgeQuestion } from '../dist/knowledge/index.js';
import { judgeKnowledgeEvidence } from '../dist/runtime/evidence-judge.js';
import { diagnosticResultFromKnowledge } from '../dist/runtime/knowledge-diagnosis.js';
import { retrieveKnowledgeWithConfiguredRetrieval } from '../dist/retrieval/configured-search.js';

function tempWorkspace() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-grounding-'));
  mkdirSync(join(workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'knowledge', 'faq', 'course'), { recursive: true });
  return workspaceRoot;
}

function writeGroundedParent(workspaceRoot, overrides = {}) {
  const id = overrides.id ?? 'kb_faq_course_visibility';
  const title = overrides.title ?? '课程发布可见性规则';
  const body = overrides.body ?? '课程发布后，学员需要满足可加入范围与有效期条件才能看到加入入口。';
  const path = join(workspaceRoot, 'knowledge', 'faq', 'course', `${id}.md`);
  writeFileSync(path, `---
id: ${id}
title: ${title}
type: faq
module: course
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 课程发布
  - 学员可见
related_repos: []
last_verified_at: ${overrides.lastVerifiedAt ?? '2026-06-20'}
owner: support
source_document: knowledge/_sources/manual/course-guide.md
source_document_id: src_course_guide
source_block_ids:
  - blk_course_visibility
section_path:
  - 课程管理
  - 发布与可见性
quality_status: ${overrides.qualityStatus ?? 'ok'}
---

# ${title}

## 答案

${body}
`, 'utf8');
  return { id, title, body, source: `knowledge/faq/course/${id}.md` };
}

function writeChunk(workspaceRoot, parent) {
  writeFileSync(join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl'), `${JSON.stringify({
    chunk_id: `chk_${parent.id}_001`,
    parent_id: parent.id,
    source: parent.source,
    module: 'course',
    intent: 'how_to',
    source_type: 'faq',
    status: 'active',
    confidence: 'high',
    visibility: 'internal',
    headings: [parent.title],
    keywords: ['课程发布', '学员可见'],
    text: parent.body,
    artifact_version: 2,
    chunking_strategy: 'parent-child-v2',
    legacy: false,
    child_order: 1,
    source_block_ids: ['blk_course_visibility'],
    section_path: ['课程管理', '发布与可见性'],
    quality_status: 'ok',
  })}\n`, 'utf8');
}

function route(overrides = {}) {
  return {
    normalizedQuestion: '课程发布后学员怎么看到加入入口',
    moduleCandidates: ['course'],
    intentCandidates: ['how_to'],
    keywords: ['课程发布', '学员', '加入入口'],
    sourceTypes: ['faq'],
    codeEscalationSignals: [],
    risks: [],
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    evidence_id: 'ev_course_visibility',
    document_id: 'kb_faq_course_visibility',
    parent_id: 'kb_faq_course_visibility',
    chunk_id: 'chk_course_visibility_001',
    source: 'knowledge/faq/course/visibility.md',
    source_document: 'knowledge/_sources/manual/course-guide.md',
    source_document_id: 'src_course_guide',
    source_block_ids: ['blk_course_visibility'],
    source_pages: [],
    section_path: ['课程管理', '发布与可见性'],
    title: '课程发布可见性规则',
    type: 'faq',
    module: 'course',
    intent: 'how_to',
    source_type: 'faq',
    confidence: 'high',
    status: 'active',
    visibility: 'internal',
    last_verified_at: '2026-06-20',
    matched_terms: ['课程发布', '学员可见'],
    summary: '课程发布可见性规则',
    excerpt: '课程发布后，学员需要满足可加入范围与有效期条件才能看到加入入口。',
    answer_span: '学员需要满足可加入范围与有效期条件才能看到加入入口。',
    score: 0.016,
    retrieval: { source: 'rerank', keywordScore: 9.5, rerankScore: 0.82 },
    quality: { severity: 'ok', issues: [] },
    ...overrides,
  };
}

function pack(result) {
  return {
    query: {
      normalized_question: '课程发布后学员怎么看到加入入口',
      module_candidates: ['course'],
      intent_candidates: ['how_to'],
      keywords: ['课程发布', '学员', '加入入口'],
    },
    results: [result],
    coverage: { searched_files: 1, matched_files: 1, filtered_out: [] },
  };
}

test('configured runtime retrieval returns trace and canonical parent grounding', async () => {
  const workspaceRoot = tempWorkspace();
  try {
    const parent = writeGroundedParent(workspaceRoot);
    writeChunk(workspaceRoot, parent);
    const config = defaultConfig();
    config.embedding.enabled = false;
    config.rerank.enabled = false;

    const result = await retrieveKnowledgeWithConfiguredRetrieval({
      config,
      query: {
        workspaceRoot,
        query: '课程发布可见性规则 学员加入入口',
        moduleCandidates: ['course'],
        visibility: ['internal'],
        limit: 5,
      },
    });

    assert.equal(result.trace.strategies.find((item) => item.id === 'bm25')?.status, 'ran');
    assert.equal(result.trace.strategies.find((item) => item.id === 'embedding')?.status, 'skipped');
    const top = result.evidencePack.results[0];
    assert.equal(top.document_id, parent.id);
    assert.equal(top.last_verified_at, '2026-06-20');
    assert.equal(top.source_document_id, 'src_course_guide');
    assert.deepEqual(top.source_block_ids, ['blk_course_visibility']);
    assert.deepEqual(top.section_path, ['课程管理', '发布与可见性']);
    assert.equal(top.quality.severity, 'ok');
    assert.match(top.answer_span, /加入入口/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('old chunks remain readable without invented grounding defaults', async () => {
  const workspaceRoot = tempWorkspace();
  try {
    writeFileSync(join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl'), `${JSON.stringify({
      chunk_id: 'chk_legacy_001',
      parent_id: 'kb_missing_parent',
      source: 'knowledge/faq/missing.md',
      module: 'general',
      intent: 'how_to',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      headings: ['Legacy answer'],
      keywords: ['legacy'],
      text: 'Legacy answer is available.',
    })}\n`, 'utf8');
    const result = await retrieveKnowledgeWithConfiguredRetrieval({
      config: defaultConfig(),
      query: { workspaceRoot, query: 'legacy answer', limit: 3 },
    });
    const top = result.evidencePack.results[0];
    assert.equal(top.last_verified_at, undefined);
    assert.equal(top.quality, undefined);
    assert.equal(top.source_document_id, undefined);
    assert.equal(top.grounding_issues.includes('rebuild_required'), true);
    assert.equal(result.trace.filters.some((item) => item.reason === 'missing_parent'), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('strict judge permits only fully grounded high-confidence evidence', () => {
  const accepted = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence()),
    question: '课程发布后学员怎么看到加入入口',
  });
  assert.equal(accepted.answerable, true);

  const warning = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence({ quality: { severity: 'warn', issues: ['multi_topic_slice'] } })),
    question: '课程发布后学员怎么看到加入入口',
  });
  assert.equal(warning.answerable, false);
  assert.equal(warning.blockers.includes('low_quality_evidence'), true);

  const missingProvenance = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence({ source_document_id: undefined, source_block_ids: undefined })),
    question: '课程发布后学员怎么看到加入入口',
  });
  assert.equal(missingProvenance.answerable, false);
  assert.equal(missingProvenance.blockers.includes('missing_provenance'), true);

  const lowRerank = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(evidence({ retrieval: { source: 'rerank', rerankScore: 0.69 } })),
    question: '学员加入入口受哪些条件影响',
  });
  assert.equal(lowRerank.answerable, false);
  assert.equal(lowRerank.blockers.includes('low_retrieval_confidence'), true);
});

test('exact-title lexical fallback stays bounded by complete grounding', () => {
  const lexical = evidence({ retrieval: { source: 'keyword', keywordScore: 12 } });
  const accepted = judgeKnowledgeEvidence({
    route: route(),
    evidencePack: pack(lexical),
    question: '课程发布可见性规则是什么？',
  });
  assert.equal(accepted.answerable, true);

  const weak = judgeKnowledgeEvidence({
    route: route({ keywords: ['课程'] }),
    evidencePack: pack(evidence({
      matched_terms: ['课', '程'],
      retrieval: { source: 'keyword', keywordScore: 12 },
    })),
    question: '课程怎么处理？',
  });
  assert.equal(weak.answerable, false);
  assert.equal(weak.blockers.includes('low_signal_terms'), true);
});

test('feature-overview lexical fallback accepts module FAQ without exact title wording', () => {
  const feature = evidence({
    evidence_id: 'ev_ai_feature_overview',
    document_id: 'kb_ai_feature_overview',
    parent_id: 'kb_ai_feature_overview',
    title: 'AI伴学助手功能清单',
    module: 'ai-companion',
    intent: 'feature_overview',
    source_type: 'faq',
    matched_terms: ['ai伴学助手', '伴学助手', 'ai伴学', '功能'],
    answer_span: 'AI伴学助手支持学习计划制定、督学提醒、学习问答、题目答疑和知识点诊断。',
    source: 'knowledge/faq/ai-companion/feature-overview.md',
    retrieval: { source: 'keyword', keywordScore: 3.87 },
  });

  const result = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: 'ai伴学助手有哪些功能',
      moduleCandidates: ['ai-companion'],
      intentCandidates: ['feature_overview'],
      keywords: ['ai伴学助手', '功能'],
      sourceTypes: ['faq', 'whitepaper', 'module_doc'],
    }),
    evidencePack: {
      query: {
        normalized_question: 'ai伴学助手有哪些功能',
        module_candidates: ['ai-companion'],
        intent_candidates: ['feature_overview'],
        keywords: ['ai伴学助手', '功能'],
      },
      results: [feature],
      coverage: { searched_files: 1, matched_files: 1, filtered_out: [] },
    },
    question: 'AI伴学助手有哪些功能？',
  });

  assert.equal(result.answerable, true, `expected answerable, blockers=${result.blockers.join(',')}`);
  assert.equal(result.blockers.includes('low_retrieval_confidence'), false);
});

test('knowledge feature overview aggregates multiple feature facts', () => {
  const overview = evidence({
    evidence_id: 'ev_ai_feature_overview',
    document_id: 'kb_ai_feature_overview',
    parent_id: 'kb_ai_feature_overview',
    title: 'AI伴学助手功能清单',
    module: 'ai-companion',
    intent: 'feature_overview',
    source_type: 'faq',
    matched_terms: ['AI伴学助手', '功能清单'],
    summary: 'AI伴学助手功能清单',
    answer_span: 'AI伴学助手支持学习计划制定、督学提醒、学习问答、题目答疑和知识点诊断。',
    source: 'knowledge/faq/ai-companion/feature-overview.md',
  });
  const learningPlan = evidence({
    evidence_id: 'ev_ai_learning_plan',
    document_id: 'kb_ai_learning_plan',
    parent_id: 'kb_ai_learning_plan',
    title: '学习计划制定',
    module: 'ai-companion',
    intent: 'feature_overview',
    source_type: 'faq',
    matched_terms: ['学习计划制定', 'AI伴学助手'],
    summary: '学习计划制定',
    answer_span: '学员加入课程后，可选择学习时间段、每周学习日来制定学习计划。',
    source: 'knowledge/faq/ai-companion/learning-plan.md',
  });
  const questionAnswer = evidence({
    evidence_id: 'ev_ai_question_answer',
    document_id: 'kb_ai_question_answer',
    parent_id: 'kb_ai_question_answer',
    title: '学习问答',
    module: 'ai-companion',
    intent: 'feature_overview',
    source_type: 'faq',
    matched_terms: ['学习问答', 'AI伴学助手'],
    summary: '学习问答',
    answer_span: '学员学习时有不理解的知识，可向AI伴学助手提问获取解答回复。',
    source: 'knowledge/faq/ai-companion/question-answer.md',
  });

  const result = diagnosticResultFromKnowledge({
    evidencePack: {
      query: {
        normalized_question: 'ai伴学助手有哪些功能',
        module_candidates: ['ai-companion'],
        intent_candidates: ['feature_overview'],
        keywords: ['AI伴学助手', '功能清单'],
      },
      results: [overview, learningPlan, questionAnswer],
      coverage: { searched_files: 3, matched_files: 3, filtered_out: [] },
    },
    route: route({
      normalizedQuestion: 'ai伴学助手有哪些功能',
      moduleCandidates: ['ai-companion'],
      intentCandidates: ['feature_overview'],
      keywords: ['AI伴学助手', '功能清单'],
      sourceTypes: ['faq', 'whitepaper', 'module_doc'],
    }),
    judge: {
      answerable: true,
      confidence: 'high',
      need_code_escalation: false,
      reason: '知识库可回答功能清单。',
      rationale: '知识库可回答功能清单。',
      evidence: ['ev_ai_feature_overview', 'ev_ai_learning_plan', 'ev_ai_question_answer'],
      risks: [],
      missing_info: [],
      conflicts: [],
      blockers: [],
      ambiguity: [],
      quality_issues: [],
      recommended_next_action: 'final_answer',
      answer_score: 0.92,
      score_breakdown: {
        relevance: 1,
        coverage: 1,
        source_authority: 1,
        freshness: 1,
        version_match: 1,
        agreement: 1,
        actionability: 1,
        conflict_penalty: 0,
        ambiguity_penalty: 0,
        risk_penalty: 0,
        quality_penalty: 0,
      },
    },
  });

  const facts = result.claims.filter((claim) => claim.type === 'fact');
  assert.equal(facts.length >= 3, true, JSON.stringify(result.claims));
  assert.match(facts.map((claim) => claim.text).join('\n'), /学习计划制定/);
  assert.match(facts.map((claim) => claim.text).join('\n'), /学习问答/);
  assert.equal(result.evidence.length >= 3, true);
});

test('knowledge direct answer keeps definition and feature semantics for what-is plus feature questions', () => {
  const definition = evidence({
    evidence_id: 'ev_class_definition',
    document_id: 'kb_class_definition',
    parent_id: 'kb_class_definition',
    title: '教务',
    module: 'edusoho-training',
    intent: 'product_rule',
    source_type: 'whitepaper',
    matched_terms: ['班课'],
    summary: '教务',
    answer_span: '教师可以在当前模块查看并管理班课相关业务内容，班课是以班级形式按照特定的时间安排所进行的课程。',
    source: 'knowledge/whitepapers/edusoho-training/class-definition.md',
  });
  const productLibrary = evidence({
    evidence_id: 'ev_product_library',
    document_id: 'kb_product_library',
    parent_id: 'kb_product_library',
    title: '产品库',
    module: 'edusoho-training',
    intent: 'product_rule',
    source_type: 'whitepaper',
    matched_terms: ['班课', '功能'],
    summary: '产品库',
    answer_span: '产品是相同课程内容不同班课的集合，方便教务人员实时了解产品的经营状况。',
    source: 'knowledge/whitepapers/edusoho-training/product-library.md',
  });
  const classManagement = evidence({
    evidence_id: 'ev_class_management',
    document_id: 'kb_class_management',
    parent_id: 'kb_class_management',
    title: '班课管理',
    module: 'edusoho-training',
    intent: 'product_rule',
    source_type: 'whitepaper',
    matched_terms: ['班课', '管理'],
    summary: '班课管理',
    answer_span: '班课管理主要是班课进行日常维护管理，以及班课巡检查看当前的直播课程。',
    source: 'knowledge/whitepapers/edusoho-training/class-management.md',
  });

  const result = diagnosticResultFromKnowledge({
    evidencePack: {
      query: {
        normalized_question: '班课是什么有什么功能',
        module_candidates: ['edusoho-training'],
        intent_candidates: [],
        keywords: ['班课', '什么', '功能'],
      },
      results: [definition, productLibrary, classManagement],
      coverage: { searched_files: 3, matched_files: 3, filtered_out: [] },
    },
    route: route({
      normalizedQuestion: '班课是什么有什么功能',
      moduleCandidates: ['edusoho-training'],
      intentCandidates: [],
      keywords: ['班课', '什么', '功能'],
      sourceTypes: ['whitepaper', 'module_doc'],
    }),
    judge: {
      answerable: true,
      confidence: 'high',
      need_code_escalation: false,
      reason: '知识库可回答班课定义和功能。',
      rationale: '知识库可回答班课定义和功能。',
      evidence: ['ev_class_definition', 'ev_product_library', 'ev_class_management'],
      risks: [],
      missing_info: [],
      conflicts: [],
      blockers: [],
      ambiguity: [],
      quality_issues: [],
      recommended_next_action: 'final_answer',
      answer_score: 0.9,
      score_breakdown: {
        relevance: 1,
        coverage: 1,
        source_authority: 1,
        freshness: 1,
        version_match: 1,
        agreement: 1,
        actionability: 1,
        conflict_penalty: 0,
        ambiguity_penalty: 0,
        risk_penalty: 0,
        quality_penalty: 0,
      },
    },
  });

  const factText = result.claims.filter((claim) => claim.type === 'fact').map((claim) => claim.text).join('\n');
  assert.equal(result.claims.filter((claim) => claim.type === 'fact').length >= 3, true, JSON.stringify(result.claims));
  assert.match(factText, /班课是以班级形式/);
  assert.match(factText, /产品库|经营状况/);
  assert.match(factText, /班课管理|班课巡检/);
  assert.doesNotMatch(factText, /知识库命中/);
});

test('knowledge direct answer uses full rag answerability covered claims', () => {
  const entryEvidence = evidence({
    evidence_id: 'ev_class_entry',
    document_id: 'kb_class_entry',
    parent_id: 'kb_class_entry',
    title: '班课配置入口',
    module: 'edusoho-training',
    intent: 'how_to',
    source_type: 'faq',
    matched_terms: ['班课', '配置', '入口'],
    summary: '班课配置入口',
    answer_span: '班课在后台管理 → 教务 → 参数设置中配置。',
    source: 'knowledge/faq/edusoho-training/class-entry.md',
  });
  const permissionEvidence = evidence({
    evidence_id: 'ev_class_permission',
    document_id: 'kb_class_permission',
    parent_id: 'kb_class_permission',
    title: '班课权限与配置项',
    module: 'edusoho-training',
    intent: 'how_to',
    source_type: 'faq',
    matched_terms: ['班课', '权限', '配置项'],
    summary: '班课权限与配置项',
    answer_span: '需要具备后台教务参数设置权限；可配置基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理。',
    source: 'knowledge/faq/edusoho-training/class-permission.md',
  });

  const result = diagnosticResultFromKnowledge({
    evidencePack: {
      query: {
        normalized_question: '班课在哪配置的',
        module_candidates: ['edusoho-training'],
        intent_candidates: ['how_to'],
        keywords: ['班课', '配置'],
      },
      results: [entryEvidence, permissionEvidence],
      coverage: { searched_files: 2, matched_files: 2, filtered_out: [] },
    },
    route: route({
      normalizedQuestion: '班课在哪配置的',
      moduleCandidates: ['edusoho-training'],
      intentCandidates: ['how_to'],
      keywords: ['班课', '配置'],
      sourceTypes: ['faq'],
    }),
    judge: {
      answerable: true,
      confidence: 'high',
      need_code_escalation: false,
      reason: '知识库可回答配置入口。',
      rationale: '知识库可回答配置入口。',
      evidence: ['ev_class_entry', 'ev_class_permission'],
      risks: [],
      missing_info: [],
      conflicts: [],
      blockers: [],
      ambiguity: [],
      quality_issues: [],
      recommended_next_action: 'final_answer',
      answer_score: 0.94,
      score_breakdown: {
        relevance: 1,
        coverage: 1,
        source_authority: 1,
        freshness: 1,
        version_match: 1,
        agreement: 1,
        actionability: 1,
        conflict_penalty: 0,
        ambiguity_penalty: 0,
        risk_penalty: 0,
        quality_penalty: 0,
      },
    },
    answerability: {
      answerability: 'full',
      selectedEvidenceIds: ['ev_class_entry', 'ev_class_permission'],
      coveredClaims: [
        {
          id: 'rag_claim_entry',
          text: '班课配置入口是后台管理 → 教务 → 参数设置。',
          evidenceIds: ['ev_class_entry'],
          coveredRequirementIds: ['entry_path'],
          usefulness: '直接回答入口路径。',
        },
        {
          id: 'rag_claim_items',
          text: '该入口需要后台教务参数设置权限，可配置基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理等。',
          evidenceIds: ['ev_class_permission'],
          coveredRequirementIds: ['permission_or_role', 'configurable_items'],
          usefulness: '补齐权限和可配置项。',
        },
      ],
      missingElements: [],
      shouldEscalate: false,
      escalationFocus: '',
      reason: '覆盖全部配置类答案要素。',
    },
  });

  const factText = result.claims.filter((claim) => claim.type === 'fact').map((claim) => claim.text).join('\n');
  assert.match(factText, /后台管理 → 教务 → 参数设置/);
  assert.match(factText, /权限/);
  assert.match(factText, /基本信息、价格、封面、服务、班主任、教师、助教、课程管理、学员管理/);
  assert.doesNotMatch(factText, /知识库命中/);
});

test('knowledge judge leaves semantic obligation coverage to independent AnswerCoverage review', () => {
  const workspaceRoot = tempWorkspace();
  try {
    const question = '学员管理的学员数据统计里面缺少6月份的数据，已经确认是定时任务没执行的问题，现在已经解决了定时任务。如何补上这个数据统计，有没有现成的命令行处理？';
    const routed = routeKnowledgeQuestion({ workspaceRoot, question });

    const result = judgeKnowledgeEvidence({
      route: route({
        normalizedQuestion: routed.normalizedQuestion,
        moduleCandidates: routed.moduleCandidates,
        intentCandidates: routed.intentCandidates,
        keywords: ['学员管理', '学员数据统计', '定时任务', '命令行'],
        sourceTypes: routed.sourceTypes,
        codeEscalationSignals: routed.codeEscalationSignals,
      }),
      evidencePack: pack(evidence({
        evidence_id: 'ev_student_statistics',
        document_id: 'kb_student_statistics',
        parent_id: 'kb_student_statistics',
        title: '用户数据统计',
        module: 'edusoho-training',
        intent: 'product_rule',
        source_type: 'whitepaper',
        matched_terms: ['学员管理', '用户数据统计', '学员数据统计'],
        summary: '学员管理用户数据统计说明',
        answer_span: '用户数据统计用于查看学员管理中的用户统计数据。',
        source: 'knowledge/whitepapers/edusoho-training/student-statistics.md',
      })),
      question,
    });

    assert.equal(result.blockers.includes('question_not_answered'), false);
    assert.equal(Array.isArray(result.evidence), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('deterministic judge does not classify answer semantics with domain keyword patterns', () => {
  const result = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: '学员统计缺少6月份如何补上，有没有命令行处理',
      moduleCandidates: ['edusoho-training'],
      intentCandidates: ['how_to'],
      keywords: ['学员统计', '6月份', '命令行'],
      sourceTypes: ['faq', 'runbook'],
    }),
    evidencePack: pack(evidence({
      evidence_id: 'ev_matched_terms_only',
      document_id: 'kb_matched_terms_only',
      parent_id: 'kb_matched_terms_only',
      title: '学员统计',
      module: 'edusoho-training',
      intent: 'product_rule',
      source_type: 'faq',
      matched_terms: ['学员统计', '6月份', '命令行', '补跑'],
      summary: '学员统计缺少数据时，可以重新生成统计数据。',
      answer_span: '学员统计缺少数据时，可以重新生成统计数据。',
      source: 'knowledge/faq/student/statistics.md',
    })),
    question: '学员统计缺少6月份如何补上，有没有命令行处理？',
  });

  assert.equal(result.blockers.includes('question_not_answered'), false);
});

test('knowledge judge can answer statistics backfill command questions when evidence contains the procedure', () => {
  const workspaceRoot = tempWorkspace();
  try {
    const question = '学员管理的学员数据统计里面缺少6月份的数据，如何补上这个数据统计，有没有现成的命令行处理？';
    const routed = routeKnowledgeQuestion({ workspaceRoot, question });
    const result = judgeKnowledgeEvidence({
      route: route({
        normalizedQuestion: routed.normalizedQuestion,
        moduleCandidates: ['edusoho-training'],
        keywords: ['学员管理', '学员数据统计', '命令行'],
        sourceTypes: ['runbook', 'faq'],
        codeEscalationSignals: routed.codeEscalationSignals,
      }),
      evidencePack: pack(evidence({
        evidence_id: 'ev_student_statistics_backfill_command',
        document_id: 'kb_student_statistics_backfill_command',
        parent_id: 'kb_student_statistics_backfill_command',
        title: '学员数据统计补跑命令',
        module: 'edusoho-training',
        intent: 'how_to',
        source_type: 'runbook',
        matched_terms: ['学员管理', '学员数据统计', '命令行', '补跑'],
        summary: '学员数据统计缺失时，可使用命令行补跑指定月份统计。',
        answer_span: '步骤1：执行 php app/console student:statistics:rebuild --month=2024-06 补跑指定月份的学员数据统计。',
        source: 'knowledge/runbooks/edusoho-training/student-statistics-backfill.md',
      })),
      question,
    });

    assert.equal(result.answerable, true, `expected answerable, blockers=${result.blockers.join(',')}, reason=${result.reason}`);
    assert.equal(result.need_code_escalation, false);
    assert.equal(result.recommended_next_action, 'final_answer');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

import { EvidenceCoverageService } from '../dist/runtime/evidence-coverage-service.js';

function fakeCoverageModel(response) {
  return {
    async complete() {
      return typeof response === 'string' ? response : JSON.stringify(response);
    },
  };
}

test('coverage agent rejects high-rerank evidence that does not answer operation-procedure question', async () => {
  const question = '学员管理的学员数据统计里面缺少6月份的数据，如何补上，有没有现成的命令行处理？';
  const featureEvidence = evidence({
    evidence_id: 'ev_user_data_statistics',
    document_id: 'kb_user_data_statistics',
    parent_id: 'kb_user_data_statistics',
    title: '用户数据统计',
    module: 'edusoho-training',
    intent: 'product_rule',
    source_type: 'whitepaper',
    matched_terms: ['学员管理', '数据统计', '学员', '统计'],
    summary: '用户数据统计：查看用户的基本学习和消费数据详情',
    answer_span: '查看用户的基本学习和消费数据详情，可以通过学员用户名、手机号进行搜索，支持数据导出。',
    excerpt: '用户数据统计：- section_path: 用户（有修改） > 学员管理 > 用户数据统计',
    score: 48.3,
    retrieval: { source: 'rerank', keywordScore: 48.3, rerankScore: 0.887 },
  });

  const judge = judgeKnowledgeEvidence({
    route: route({
      normalizedQuestion: question,
      moduleCandidates: [],
      intentCandidates: [],
      keywords: ['学员管理', '数据统计', '命令行'],
      sourceTypes: ['faq', 'runbook'],
    }),
    evidencePack: pack(featureEvidence),
    question,
  });

  const coverageService = new EvidenceCoverageService(
    fakeCoverageModel({
      coverage: 'not_covered',
      missing_elements: ['补跑/重跑数据的步骤', '命令行名称或参数'],
      reason: '证据只描述了用户数据统计的页面功能，未覆盖补数据步骤或命令行操作',
    }),
    'spec',
  );

  const coverage = await coverageService.evaluate({ question, evidence: [featureEvidence] });
  assert.equal(coverage.coverage, 'not_covered');
  assert.equal(coverage.missingElements.length, 2);
});

test('coverage agent preserves direct answer when evidence truly covers question', async () => {
  const question = '学员数据统计缺失如何补跑，有没有命令行？';
  const runbookEvidence = evidence({
    evidence_id: 'ev_student_stats_backfill',
    document_id: 'kb_student_stats_backfill',
    parent_id: 'kb_student_stats_backfill',
    title: '学员数据统计补跑命令',
    module: 'edusoho-training',
    intent: 'how_to',
    source_type: 'runbook',
    matched_terms: ['学员数据统计', '补跑', '命令行'],
    summary: '学员数据统计缺失时可用命令行补跑指定月份',
    answer_span: '执行 php app/console student:statistics:rebuild --month=2024-06 补跑指定月份学员数据统计。',
    excerpt: '步骤1：执行 php app/console student:statistics:rebuild --month=YYYY-MM',
    retrieval: { source: 'rerank', keywordScore: 30, rerankScore: 0.92 },
  });

  const coverageService = new EvidenceCoverageService(
    fakeCoverageModel({
      coverage: 'covered',
      missing_elements: [],
      reason: '证据包含具体补跑命令和参数',
    }),
    'spec',
  );

  const coverage = await coverageService.evaluate({ question, evidence: [runbookEvidence] });
  assert.equal(coverage.coverage, 'covered');
});
