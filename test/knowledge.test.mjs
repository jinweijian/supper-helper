import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import {
  approveSolvedCase,
  approveQualityCleanDraftSlices,
  auditKnowledgeQuality,
  buildKnowledgeVectorIndex,
  buildDraftSlices,
  discoverSourceFiles,
  evaluateQualityGate,
  generateKnowledgeRepairPlan,
  initKnowledgeWorkspace,
  intakeSourceDocument,
  parseMarkdownDocument,
  publishApprovedDraftSlices,
  resolveKnowledgeWorkspaceRoot,
  reviewDraftSlices,
  routeKnowledgeQuestion,
  updateKnowledgeIndex,
  applyKnowledgeRepairPlan,
  writeKnowledgeRepairPlan,
  writeKnowledgeQualityReport,
} from '../dist/knowledge/index.js';
import { retrieveKnowledgeWithConfiguredRetrieval } from '../dist/retrieval/configured-search.js';
import { listPublicAgentConfigs, loadAgentRegistry } from '../dist/runtime/agent-configs.js';

function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), 'super-helper-knowledge-'));
}

function cleanup(path) {
  rmSync(path, { recursive: true, force: true });
}

async function retrieveEvidence(query) {
  const config = defaultConfig();
  config.embedding.enabled = false;
  config.rerank.enabled = false;
  const result = await retrieveKnowledgeWithConfiguredRetrieval({ config, query });
  return result.evidencePack;
}

function writeTestFaq(workspace, input) {
  const dir = join(workspace, 'knowledge', 'faq', 'account');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${input.id}.md`),
    `---
id: ${input.id}
title: ${input.title}
type: faq
module: account
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
${input.terms.map((term) => `  - ${term}`).join('\n')}
related_repos: []
last_verified_at: 2026-06-15
owner: support
source_document: knowledge/_sources/manual/test-faq.md
source_document_id: src_test_faq
source_block_ids:
  - blk_${input.id}
section_path:
  - ${input.title}
quality_status: ok
---

# ${input.title}

${input.body}
`,
    'utf8',
  );
}

test('knowledge init creates the enterprise knowledge workspace skeleton', async () => {
  const workspace = tempWorkspace();
  try {
    const result = initKnowledgeWorkspace({ workspaceRoot: workspace });
    const knowledgeRoot = join(workspace, 'knowledge');

    assert.equal(result.knowledgeRoot, knowledgeRoot);
    assert.equal(result.created, true);
    assert.equal(existsSync(join(knowledgeRoot, '_sources', 'whitepapers')), true);
    assert.equal(existsSync(join(knowledgeRoot, '_taxonomy', 'modules.yaml')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'faq', 'README.md')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'whitepapers', 'README.md')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'manifest.json')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'chunks.jsonl')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'dirty.flag')), true);
    assert.match(readFileSync(join(knowledgeRoot, 'faq', 'README.md'), 'utf8'), /type: faq/);
    assert.match(readFileSync(join(knowledgeRoot, 'whitepapers', 'README.md'), 'utf8'), /source_pages/);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge intake exposes per-file stages and reuses unchanged content', async () => {
  const workspace = tempWorkspace();
  const sourceDir = tempWorkspace();
  try {
    const path = join(sourceDir, 'guide.md');
    writeFileSync(path, '# Guide\n\nA meaningful answer-bearing paragraph.', 'utf8');
    const [source] = discoverSourceFiles(sourceDir);
    const first = intakeSourceDocument({ workspaceRoot: workspace, sourcePath: source });
    const second = intakeSourceDocument({ workspaceRoot: workspace, sourcePath: source });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(first.sourceDocumentId, second.sourceDocumentId);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
  }
});

test('knowledge workspace scope stores knowledge outside project roots and isolates by workspace', async () => {
  const storageRoot = tempWorkspace();
  const firstProject = tempWorkspace();
  const secondProject = tempWorkspace();
  try {
    const config = {
      storage: { rootDir: storageRoot, isolateByWorkspace: true },
      knowledge: { rootDir: join(storageRoot, 'knowledge-store'), isolateByWorkspace: true },
      workspaces: [
        { id: 'first', name: 'First Project', rootPath: firstProject, mcpToolIds: [] },
        { id: 'second', name: 'Second Project', rootPath: secondProject, mcpToolIds: [] },
      ],
    };

    const firstKnowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'first');
    const secondKnowledgeWorkspace = resolveKnowledgeWorkspaceRoot(config, 'second');
    const result = initKnowledgeWorkspace({ workspaceRoot: firstKnowledgeWorkspace });

    assert.notEqual(firstKnowledgeWorkspace, firstProject);
    assert.notEqual(firstKnowledgeWorkspace, secondKnowledgeWorkspace);
    assert.equal(result.knowledgeRoot, join(firstKnowledgeWorkspace, 'knowledge'));
    assert.equal(existsSync(join(firstProject, 'knowledge')), false);
    assert.equal(existsSync(join(secondProject, 'knowledge')), false);
    assert.equal(existsSync(join(firstKnowledgeWorkspace, 'knowledge', 'indexes', 'manifest.json')), true);
  } finally {
    cleanup(storageRoot);
    cleanup(firstProject);
    cleanup(secondProject);
  }
});

test('knowledge update indexes markdown slices and search expands chunk hits to the parent slice', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const knowledgeRoot = join(workspace, 'knowledge');
    const sourceDir = join(knowledgeRoot, '_sources', 'whitepapers');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'course-whitepaper.meta.json'),
      `${JSON.stringify({
        id: 'src_course_whitepaper',
        source_type: 'whitepaper_pdf',
        path: 'knowledge/_sources/whitepapers/course-whitepaper.pdf',
        sha256: 'test-hash',
        title: 'Course Whitepaper',
        downloaded_at: '2026-06-13T00:00:00.000Z',
        product_versions: ['>=2025.10'],
        page_count: 42,
        owner: 'product-course',
        ingest_tool_version: 'pdf-ingest-v1',
      }, null, 2)}\n`,
      'utf8',
    );

    const whitepaperDir = join(knowledgeRoot, 'whitepapers', 'course');
    mkdirSync(whitepaperDir, { recursive: true });
    writeFileSync(
      join(whitepaperDir, 'visibility.md'),
      `---
id: kb_whitepaper_course_visibility
title: 课程可见性规则
type: whitepaper_slice
module: course
intent: product_rule
source_type: whitepaper
confidence: medium
status: active
visibility: internal
product_versions:
  - ">=2025.10"
related_terms:
  - 课程发布
  - 学员端
related_repos:
  - course-service
last_verified_at: 2026-06-13
owner: product-course
source_document: knowledge/_sources/whitepapers/course-whitepaper.pdf
source_document_id: src_course_whitepaper
source_pages:
  - 12
  - 13
section_path:
  - 课程管理
  - 发布与可见性
chunking_strategy: semantic-section-v1
---

# 课程可见性规则

## 核心规则

课程必须同时满足发布状态、可见范围、学员权限和上架时间条件，才会在学员端展示。

## 例外情况

如果课程被下线，学员端不会展示。
`,
      'utf8',
    );

    const update = updateKnowledgeIndex({ workspaceRoot: workspace });
    assert.equal(update.documentCount, 1);
    assert.equal(update.chunkCount, 2);
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'dirty.flag')), false);

    const chunks = readFileSync(update.chunksPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(chunks[0].parent_id, 'kb_whitepaper_course_visibility');
    assert.deepEqual(chunks[0].source_pages, [12, 13]);

    const result = await retrieveEvidence({
      workspaceRoot: workspace,
      query: '课程发布后为什么学员端看不到',
      limit: 5,
    });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].document_id, 'kb_whitepaper_course_visibility');
    assert.equal(result.results[0].parent_id, 'kb_whitepaper_course_visibility');
    assert.equal(result.results[0].source_document, 'knowledge/_sources/whitepapers/course-whitepaper.pdf');
    assert.deepEqual(result.results[0].source_pages, [12, 13]);
    assert.match(result.results[0].excerpt, /课程必须同时满足发布状态|如果课程被下线/);

    writeFileSync(join(knowledgeRoot, 'indexes', 'dirty.flag'), 'rebuild required\n', 'utf8');
    const dirtyResult = await retrieveEvidence({
      workspaceRoot: workspace,
      query: '课程发布后为什么学员端看不到',
      limit: 5,
    });
    assert.equal(dirtyResult.results[0].document_id, 'kb_whitepaper_course_visibility');
  } finally {
    cleanup(workspace);
  }
});

test('knowledge CLI initializes and updates a workspace', async () => {
  const workspace = tempWorkspace();
  const knowledgeBase = tempWorkspace();
  try {
    const initOutput = execFileSync(process.execPath, [
      'dist/cli.js',
      'knowledge',
      'init',
      '--workspace',
      workspace,
      '--knowledge-root',
      knowledgeBase,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.match(initOutput, /knowledge workspace ready/);
    assert.equal(existsSync(join(workspace, 'knowledge')), false);
    assert.match(initOutput, new RegExp(escapeRegExp(knowledgeBase)));

    const updateOutput = execFileSync(process.execPath, [
      'dist/cli.js',
      'knowledge',
      'update',
      '--workspace',
      workspace,
      '--knowledge-root',
      knowledgeBase,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.match(updateOutput, /knowledge index updated/);
    assert.match(updateOutput, /chunks:/);
  } finally {
    cleanup(workspace);
    cleanup(knowledgeBase);
  }
});

test('knowledge init leaves imported whitepaper slices as drafts by default', async () => {
  const workspace = tempWorkspace();
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-source-docx-'));
  try {
    const docxPath = join(sourceDir, 'AI伴学助手用户指南.docx');
    const trainingDocxPath = join(sourceDir, 'EduSoho教培线用户指南.docx');
    writeMinimalDocx(docxPath, [
      { style: '2', text: 'AI伴学助手' },
      { style: '3', text: '制定学习计划' },
      { text: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。' },
      { text: '学习计划生成后包含任务数、学习总时长、学习起止时间、每周学习日和每日学习时长。' },
      { style: '3', text: '督学提醒' },
      { text: '学习日上午9点以对话框消息和 APP 通知的形式向学员发送学习提醒。' },
      { text: '学习日晚上8点未完成当日学习任务时，会通过 AI 伴学助手和 APP 通知发送提醒。' },
    ]);
    writeMinimalDocx(trainingDocxPath, [
      { style: '2', text: 'EduSoho教培线' },
      { style: '3', text: '课程搜索' },
      { text: '课程列表的搜索栏支持按照课程名称、课程编号和课程分类搜索课程。' },
      { text: '管理员也可以通过课程状态筛选已发布、未发布或已关闭的课程。' },
      { style: '3', text: '班级学员' },
      { text: '班级学员列表支持查看学员加入时间、学习进度和作业完成状态。' },
    ]);

    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir });
    const knowledgeRoot = join(workspace, 'knowledge');
    const report = JSON.parse(readFileSync(join(knowledgeRoot, 'indexes', 'ingest-report.json'), 'utf8'));

    assert.equal(report.sourceDocuments, 2);
    assert.equal(report.parentSlices >= 2, true);
    assert.equal(report.chunks, 0);
    assert.equal(
      report.imported.some((item) => item.sourceDocumentPath.includes('AI伴学助手用户指南.docx')),
      true,
    );
    assert.equal(
      report.imported.some((item) => item.sourceDocumentPath.includes('EduSoho教培线用户指南.docx')),
      true,
    );
    assert.equal(existsSync(join(knowledgeRoot, 'indexes', 'chunk-quality-report.json')), true);
    assert.equal(existsSync(join(knowledgeRoot, 'reports', 'source-quality-report.json')), true);
    for (const imported of report.imported) {
      assert.equal(existsSync(imported.draftRoot), true);
    }

    const activeWhitepaperSlices = findGeneratedMarkdown(join(knowledgeRoot, 'whitepapers'));
    assert.equal(activeWhitepaperSlices.length, 0, 'safe init must not create active whitepaper slices');

    const aiResult = await retrieveEvidence({
      workspaceRoot: workspace,
      query: '学习日晚上8点没有完成任务会怎么提醒',
      limit: 5,
    });

    assert.equal(aiResult.results.length, 0);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
  }
});

test('source intake keeps same filename with different content in separate hash paths', async () => {
  const workspace = tempWorkspace();
  const sourceDir = tempWorkspace();
  try {
    const sourcePath = join(sourceDir, '产品白皮书.md');
    writeFileSync(sourcePath, '# 产品白皮书\n\n版本一会在晚上8点提醒未完成任务。\n', 'utf8');
    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir });
    const firstReport = JSON.parse(readFileSync(join(workspace, 'knowledge', 'indexes', 'ingest-report.json'), 'utf8'));
    const firstStored = firstReport.imported[0].sourceDocumentPath;
    const firstStoredAbsolute = join(workspace, firstStored);

    writeFileSync(sourcePath, '# 产品白皮书\n\n版本二支持按课程名称搜索课程。\n', 'utf8');
    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir });
    const secondReport = JSON.parse(readFileSync(join(workspace, 'knowledge', 'indexes', 'ingest-report.json'), 'utf8'));
    const secondStored = secondReport.imported[0].sourceDocumentPath;

    assert.notEqual(firstStored, secondStored);
    assert.match(readFileSync(firstStoredAbsolute, 'utf8'), /版本一/);
    assert.match(readFileSync(join(workspace, secondStored), 'utf8'), /版本二/);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
  }
});

test('legacy active publish is explicit and visible', async () => {
  const workspace = tempWorkspace();
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-source-docx-'));
  try {
    const docxPath = join(sourceDir, 'AI伴学助手用户指南.docx');
    const trainingDocxPath = join(sourceDir, 'EduSoho教培线用户指南.docx');
    writeMinimalDocx(docxPath, [
      { style: '2', text: 'AI伴学助手' },
      { style: '3', text: '督学提醒' },
      { text: '学习日晚上8点未完成当日学习任务时，会通过 AI 伴学助手和 APP 通知发送提醒。' },
    ]);
    writeMinimalDocx(trainingDocxPath, [
      { style: '2', text: 'EduSoho教培线' },
      { style: '3', text: '课程搜索' },
      { text: '课程列表的搜索栏支持按照课程名称、课程编号和课程分类搜索课程。' },
    ]);

    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir, legacyActivePublish: true });
    const knowledgeRoot = join(workspace, 'knowledge');
    const report = JSON.parse(readFileSync(join(knowledgeRoot, 'indexes', 'ingest-report.json'), 'utf8'));

    assert.equal(report.compatibility_mode, 'legacy_active_publish');
    assert.equal(report.quality_gate_bypassed, true);
    assert.equal(report.chunks >= 2, true);

    const aiResult = await retrieveEvidence({
      workspaceRoot: workspace,
      query: '学习日晚上8点没有完成任务会怎么提醒',
      limit: 5,
    });

    assert.equal(aiResult.results.length > 0, true);
    assert.equal(aiResult.results[0].source_type, 'whitepaper');
    assert.match(aiResult.results[0].source_document, /AI伴学助手用户指南\.docx|ai-ban-xue-zhu-shou-yong-hu-zhi-nan\.docx/);
    assert.match(aiResult.results[0].excerpt, /晚上8点未完成当日学习任务/);

    const trainingResult = await retrieveEvidence({
      workspaceRoot: workspace,
      query: '课程搜索栏支持按什么搜索课程',
      limit: 5,
    });

    assert.equal(trainingResult.results.length > 0, true);
    assert.equal(trainingResult.results[0].source_type, 'whitepaper');
    assert.match(trainingResult.results[0].source_document, /EduSoho教培线用户指南\.docx|edusoho-jiao-pei-xian-yong-hu-zhi-nan\.docx/i);
    assert.match(trainingResult.results[0].excerpt, /课程名称、课程编号和课程分类/);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
  }
});

test('knowledge init does not overwrite edited parent slices unless forced', async () => {
  const workspace = tempWorkspace();
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-source-docx-'));
  try {
    const docxPath = join(sourceDir, 'AI伴学助手用户指南.docx');
    writeMinimalDocx(docxPath, [
      { style: '2', text: 'AI伴学助手' },
      { style: '3', text: '制定学习计划' },
      { text: '学员加入课程后，可以通过 AI 伴学助手制定学习计划。' },
    ]);

    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir, legacyActivePublish: true });
    const generatedSlice = findFirstGeneratedMarkdown(join(workspace, 'knowledge', 'whitepapers'));
    const editedContent = `${readFileSync(generatedSlice, 'utf8')}\n\n人工修订保留。\n`;
    writeFileSync(generatedSlice, editedContent, 'utf8');

    initKnowledgeWorkspace({ workspaceRoot: workspace, sourceDir, legacyActivePublish: true });

    assert.equal(readFileSync(generatedSlice, 'utf8'), editedContent);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
  }
});

test('configured retrieval finds FAQ and runbook documents while filtering deprecated documents', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const knowledgeRoot = join(workspace, 'knowledge');
    const faqDir = join(knowledgeRoot, 'faq', 'general');
    const runbookDir = join(knowledgeRoot, 'runbooks', 'general');
    const glossaryDir = join(knowledgeRoot, 'glossary', 'terms');
    mkdirSync(faqDir, { recursive: true });
    mkdirSync(runbookDir, { recursive: true });
    mkdirSync(glossaryDir, { recursive: true });
    writeFileSync(
      join(faqDir, 'password.md'),
      `---
id: kb_faq_general_password
title: 如何重置密码
type: faq
module: general
intent: how_to
source_type: faq
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 重置密码
  - 账号
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 如何重置密码

## 答案

管理员可以在账号管理页面重置密码。
`,
      'utf8',
    );
    writeFileSync(
      join(runbookDir, 'login.md'),
      `---
id: kb_runbook_general_login
title: 登录失败排查
type: runbook
module: general
intent: troubleshooting
source_type: runbook
confidence: high
status: active
visibility: internal
product_versions: []
related_terms:
  - 登录失败
  - 账号
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 登录失败排查

## 快速判断

先确认账号状态和密码是否过期。
`,
      'utf8',
    );
    writeFileSync(
      join(faqDir, 'deprecated.md'),
      `---
id: kb_faq_general_deprecated
title: 废弃功能说明
type: faq
module: general
intent: how_to
source_type: faq
confidence: high
status: deprecated
visibility: internal
product_versions: []
related_terms:
  - 废弃功能
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 废弃功能说明

这个文档不能作为可回答证据。
`,
      'utf8',
    );
    writeFileSync(
      join(glossaryDir, 'account.md'),
      `---
id: kb_glossary_account
title: 账号
type: glossary_term
module: general
intent: term_explanation
source_type: glossary
confidence: low
status: active
visibility: internal
product_versions: []
related_terms:
  - 账号
related_repos: []
last_verified_at: 2026-06-13
owner: support
---

# 账号

## 定义

账号是用户登录和权限识别的主体。
`,
      'utf8',
    );

    updateKnowledgeIndex({ workspaceRoot: workspace });

    const password = await retrieveEvidence({ workspaceRoot: workspace, query: '怎么重置密码' });
    const login = await retrieveEvidence({ workspaceRoot: workspace, query: '登录失败怎么排查' });
    const deprecated = await retrieveEvidence({ workspaceRoot: workspace, query: '废弃功能怎么用' });
    const glossary = await retrieveEvidence({ workspaceRoot: workspace, query: '账号是什么意思', sourceTypes: ['glossary'] });
    const account = await retrieveEvidence({ workspaceRoot: workspace, query: '账号', limit: 1 });
    const noHit = await retrieveEvidence({ workspaceRoot: workspace, query: '完全不存在的问题' });
    assert.equal(password.results[0].source_type, 'faq');
    assert.equal(login.results[0].source_type, 'runbook');
    assert.equal(deprecated.results.length, 0);
    assert.equal(glossary.results[0].confidence, 'low');
    assert.equal(account.results.length, 1);
    assert.equal(noHit.results.length, 0);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge router identifies module and intent from taxonomy aliases', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const taxonomyDir = join(workspace, 'knowledge', '_taxonomy');
    writeFileSync(
      join(taxonomyDir, 'modules.yaml'),
      `modules:
  - id: ai-study
    name: AI伴学助手
    keywords:
      - AI伴学助手
      - 学习计划
      - 督学提醒
`,
      'utf8',
    );
    writeFileSync(
      join(taxonomyDir, 'aliases.yaml'),
      `aliases:
  - term: 伴学
    module: ai-study
  - term: AI助教
    module: ai-study
`,
      'utf8',
    );
    writeFileSync(
      join(taxonomyDir, 'intents.yaml'),
      `intents:
  - id: how_to
    keywords:
      - 怎么
      - 如何
`,
      'utf8',
    );

    const route = routeKnowledgeQuestion({
      workspaceRoot: workspace,
      question: '伴学怎么制定学习计划？',
    });

    assert.deepEqual(route.moduleCandidates, ['ai-study']);
    assert.deepEqual(route.intentCandidates, ['how_to']);
    assert.equal(route.keywords.includes('伴学'), true);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge router classifies concrete feature overview questions', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const route = routeKnowledgeQuestion({
      workspaceRoot: workspace,
      question: 'AI伴学助手有哪些功能？',
    });

    assert.deepEqual(route.moduleCandidates, ['ai-companion']);
    assert.equal(route.intentCandidates.includes('feature_overview'), true);
    assert.equal(route.sourceTypes.includes('faq'), true);
    assert.equal(route.sourceTypes.includes('whitepaper'), true);
    assert.equal(route.sourceTypes.includes('module_doc'), true);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge router does not hard-code business backfill wording as code escalation', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const route = routeKnowledgeQuestion({
      workspaceRoot: workspace,
      question: '学员管理的学员数据统计缺少6月份的数据，定时任务已经修好，如何补上这个统计，有没有现成的命令行处理？',
    });

    assert.equal(route.codeEscalationSignals.includes('command_or_job'), false);
    assert.equal(route.codeEscalationSignals.includes('data_backfill'), false);
  } finally {
    cleanup(workspace);
  }
});

test('frontmatter validation reports missing required fields', async () => {
  assert.throws(
    () => parseMarkdownDocument('---\nid: kb_invalid\n---\n# Invalid\n', 'invalid.md'),
    /missing required frontmatter fields/,
  );
});

test('knowledge agent configs are registered for future runtime wiring', async () => {
  const stages = loadAgentRegistry().agents.map((agent) => agent.stage);

  assert.equal(stages.includes('knowledge_router'), true);
  assert.equal(stages.includes('evidence_judge'), true);
  assert.equal(stages.includes('case_curator'), true);
  assert.equal(listPublicAgentConfigs().some((agent) => agent.stage === 'evidence_judge' && !agent.mayProduceUserFacingText), true);
});

function writeMinimalDocx(path, paragraphs) {
  const dir = mkdtempSync(join(tmpdir(), 'minimal-docx-'));
  const wordDir = join(dir, 'word');
  mkdirSync(wordDir, { recursive: true });
  writeFileSync(
    join(dir, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    'utf8',
  );
  writeFileSync(
    join(wordDir, 'styles.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="3"><w:name w:val="heading 2"/></w:style>
</w:styles>`,
    'utf8',
  );
  const body = paragraphs.map((paragraph) => {
    const style = paragraph.style ? `<w:pPr><w:pStyle w:val="${paragraph.style}"/></w:pPr>` : '';
    return `<w:p>${style}<w:r><w:t>${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
  }).join('');
  writeFileSync(
    join(wordDir, 'document.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    'utf8',
  );
  execFileSync('zip', ['-qr', path, '[Content_Types].xml', 'word'], { cwd: dir });
  cleanup(dir);
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findFirstGeneratedMarkdown(root) {
  const entries = findGeneratedMarkdown(root);
  assert.equal(entries.length > 0, true);
  return entries[0];
}

function findGeneratedMarkdown(root) {
  if (!existsSync(root)) {
    return [];
  }
  return execFileSync('find', [root, '-type', 'f', '-name', '*.md'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.endsWith('/README.md'))
    .sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('knowledge quality audit detects empty body and missing provenance', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const faqDir = join(workspace, 'knowledge', 'faq', 'general');
    mkdirSync(faqDir, { recursive: true });
    // Slice with no body content and no source_document
    writeFileSync(
      join(faqDir, 'empty-faq.md'),
      `---
id: kb_faq_general_empty
title: 空 FAQ
type: faq
module: general
intent: how_to
source_type: faq
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 空 FAQ

## 问题

## 答案
`,
      'utf8',
    );
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace, gate: 'warn' });
    const codes = report.issues.map((i) => i.code);
    assert.equal(codes.includes('missing_source_document'), true, 'expected missing_source_document');
    assert.equal(codes.includes('missing_source_document_id'), true, 'expected missing_source_document_id');
    assert.equal(codes.includes('empty_body') || codes.includes('heading_only'), true, 'expected empty body issue');
  } finally {
    cleanup(workspace);
  }
});

test('knowledge repair plan can be generated and applied for safe actions', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const faqDir = join(workspace, 'knowledge', 'faq', 'general');
    mkdirSync(faqDir, { recursive: true });
    const slicePath = join(faqDir, 'low-signals.md');
    writeFileSync(
      slicePath,
      `---
id: kb_faq_general_lowsignals
title: 弱信号 FAQ
type: faq
module: general
intent: how_to
source_type: faq
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms:
  - 一个
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
source_document: knowledge/_sources/whitepapers/test.docx
source_document_id: src_test
source_pages: []
section_path:
  - 弱信号 FAQ
---

# 弱信号 FAQ

## 问题

弱信号

## 答案

弱信号答案
`,
      'utf8',
    );
    updateKnowledgeIndex({ workspaceRoot: workspace });
    const report = auditKnowledgeQuality({ workspaceRoot: workspace });
    const path = writeKnowledgeQualityReport({ workspaceRoot: workspace, report });
    assert.equal(existsSync(path), true);
    const plan = generateKnowledgeRepairPlan({ workspaceRoot: workspace });
    assert.equal(plan.actions.length > 0, true);
  } finally {
    cleanup(workspace);
  }
});

test('safe merge repair action mutates adjacent draft slices instead of silently skipping', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const draftRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_merge_repair');
    mkdirSync(draftRoot, { recursive: true });
    writeFileSync(join(draftRoot, '001-short.md'), approvedDraftMarkdown('drf_merge_001', 'draft', 'warn').replace('当审核通过后，知识库发布命令会把通过审核的草稿写入正式知识目录，并保留来源和审核信息。', '短内容一。'), 'utf8');
    writeFileSync(join(draftRoot, '002-short.md'), approvedDraftMarkdown('drf_merge_002', 'draft', 'warn').replace('当审核通过后，知识库发布命令会把通过审核的草稿写入正式知识目录，并保留来源和审核信息。', '短内容二。'), 'utf8');

    const quality = auditKnowledgeQuality({ workspaceRoot: workspace });
    const qualityPath = writeKnowledgeQualityReport({ workspaceRoot: workspace, report: quality });
    assert.equal(existsSync(qualityPath), true);
    const plan = generateKnowledgeRepairPlan({ workspaceRoot: workspace });
    assert.equal(plan.actions.some((action) => action.actionType === 'merge_adjacent_short_slices' && action.safety === 'safe'), true);
    const planPath = writeKnowledgeRepairPlan({ workspaceRoot: workspace, plan, timestamp: 'merge-test' });
    const result = applyKnowledgeRepairPlan({ workspaceRoot: workspace, planPath });

    assert.equal(result.appliedActions.some((action) => action.actionType === 'merge_adjacent_short_slices'), true);
    assert.equal(result.changedFiles.length >= 2, true);
    assert.match(readFileSync(join(draftRoot, '001-short.md'), 'utf8'), /短内容一[\s\S]*短内容二/);
    assert.match(readFileSync(join(draftRoot, '002-short.md'), 'utf8'), /status: archived/);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge review records are written and statuses change', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const dir = join(workspace, 'knowledge', 'tickets', 'solved-cases', 'general');
    mkdirSync(dir, { recursive: true });
    const slicePath = join(dir, 'sample.md');
    writeFileSync(
      slicePath,
      `---
id: kb_case_solved_general_sample
title: 示例 Case
type: solved_case
module: general
intent: troubleshooting
source_type: solved_case
confidence: medium
status: review_required
visibility: internal
product_versions: []
related_terms:
  - 示例
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例

## 用户原始问题

## 解决方案

`,
      'utf8',
    );
    updateKnowledgeIndex({ workspaceRoot: workspace });
    // Use a known source id from the existing pipeline (not really required for review)
    // We need to create a draft root with at least one slice in _pipeline for reviewDraftSlices.
    const draftsRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_test_001');
    mkdirSync(draftsRoot, { recursive: true });
    writeFileSync(
      join(draftsRoot, '001-test.md'),
      `---
id: drf_test_001
title: 测试
type: whitepaper_slice
module: general
intent: product_rule
source_type: whitepaper
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
source_document_id: src_test_001
source_block_ids:
  - blk_test_001_00001
section_path: []
chunking_strategy: semantic-section-v2
pipeline_stage: slice
pipeline_status: draft
quality_status: unchecked
---

# 测试

## 核心内容

Test body.
`,
      'utf8',
    );
    const record = reviewDraftSlices({
      workspaceRoot: workspace,
      sourceDocumentId: 'src_test_001',
      action: 'approve',
      reviewer: 'test-user',
      notes: 'approve for test',
    });
    assert.equal(record.action, 'approve');
    assert.equal(record.reviewedIds.length, 1);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge quality gate evaluator distinguishes warn and strict', async () => {
  const report = {
    version: 1,
    workspaceRoot: '/tmp',
    knowledgeRoot: '/tmp/knowledge',
    generatedAt: new Date().toISOString(),
    thresholds: { minBodyChars: 80, maxParentChars: 2800, maxUnknownBlockRatio: 0.3, minRelatedTerms: 3, maxDuplicateNormalizedHashes: 1, multiTopicHeadingThreshold: 3 },
    inspected: { sourceDocuments: 0, draftSlices: 0, publishedSlices: 0, chunks: 0 },
    stageSummaries: {},
    severityCounts: { info: 0, warn: 0, error: 0 },
    issueCounts: {},
    issues: [],
    recommendedActions: [],
    gate: 'warn',
  };
  // Off: passes
  const off = evaluateQualityGate(report, 'off');
  assert.equal(off.passed, true);
  // Warn with no errors: passes
  const warnOk = evaluateQualityGate(report, 'warn');
  assert.equal(warnOk.passed, true);
  // Strict with errors: fails
  report.severityCounts.error = 1;
  const strictFail = evaluateQualityGate(report, 'strict');
  assert.equal(strictFail.passed, false);
  assert.equal(strictFail.exitCode, 2);
});

test('solved case review accepts relative path without leading slash (regression for case-review path check)', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const dir = join(workspace, 'knowledge', 'tickets', 'solved-cases', 'general');
    mkdirSync(dir, { recursive: true });
    const slicePath = join(dir, 'sample.md');
    writeFileSync(
      slicePath,
      `---
id: kb_case_solved_general_regression
title: 回归 Case
type: solved_case
module: general
intent: troubleshooting
source_type: solved_case
confidence: medium
status: review_required
visibility: internal
product_versions: []
related_terms:
  - 回归
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 回归

## 用户原始问题

## 解决方案
`,
      'utf8',
    );
    // The user supplies a relative path (no leading slash) — must not throw path-not-under-solved-cases
    const record = approveSolvedCase({
      workspaceRoot: workspace,
      pathOrId: 'knowledge/tickets/solved-cases/general/sample.md',
      reviewer: 'tester',
      notes: 'approve',
    });
    assert.equal(record.action, 'approve');
    assert.equal(record.nextStatus, 'active');
  } finally {
    cleanup(workspace);
  }
});

test('knowledge publish reads pipeline_status back from frontmatter (regression for parseMarkdownDocument pipeline fields)', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    // Create a draft with pipeline_status: approved
    const draftsRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_publish_test');
    mkdirSync(draftsRoot, { recursive: true });
    writeFileSync(
      join(draftsRoot, '001-test.md'),
      `---
id: drf_publish_test_001
title: 测试发布
type: whitepaper_slice
module: general
intent: product_rule
source_type: whitepaper
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
source_document_id: src_publish_test
source_block_ids:
  - blk_publish_test_00001
section_path: []
chunking_strategy: semantic-section-v2
pipeline_stage: slice
pipeline_status: approved
quality_status: ok
---

# 测试发布

## 核心内容

This is a meaningful content body that exceeds the minimum body length requirement for an answer-bearing slice.

## 原文来源

- source_document_id: src_publish_test
`,
      'utf8',
    );
    writeKnowledgeQualityReport({
      workspaceRoot: workspace,
      report: emptyQualityReport(workspace),
    });
    const report = publishApprovedDraftSlices({ workspaceRoot: workspace, sourceDocumentId: 'src_publish_test', qualityGate: 'warn' });
    // The approved draft should be picked up and published to the formal tree
    assert.equal(report.publishedIds.length >= 1, true, `expected >=1 published, got ${report.publishedIds.length}`);
    assert.equal(report.indexDirty, true);
  } finally {
    cleanup(workspace);
  }
});

test('knowledge publish rejects ok quality status when no audit report exists', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const draftsRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_no_audit');
    mkdirSync(draftsRoot, { recursive: true });
    writeFileSync(join(draftsRoot, '001-test.md'), approvedDraftMarkdown('drf_no_audit_001', 'approved', 'ok'), 'utf8');
    rmSync(join(workspace, 'knowledge', 'indexes', 'chunk-quality-report.json'), { force: true });
    const report = publishApprovedDraftSlices({ workspaceRoot: workspace, sourceDocumentId: 'src_no_audit', qualityGate: 'warn' });
    assert.equal(report.publishedIds.length, 0);
    assert.deepEqual(report.rejectedIds, ['drf_no_audit_001']);
    assert.match(report.warningOverrides[0].reason, /quality audit report is required/);
  } finally {
    cleanup(workspace);
  }
});

test('draft slicer splits oversized heading group into multiple draft files', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const blocks = [
      normalizedBlock('src_split', 1, 'heading', '课程搜索'),
      normalizedBlock('src_split', 2, 'paragraph', '课程搜索支持按课程名称进行精确查询。'.repeat(6)),
      normalizedBlock('src_split', 3, 'paragraph', '课程搜索支持按课程编号进行精确查询。'.repeat(6)),
      normalizedBlock('src_split', 4, 'paragraph', '课程搜索支持按课程分类进行筛选查询。'.repeat(6)),
    ];
    const result = buildDraftSlices({
      workspaceRoot: workspace,
      sourceDocumentId: 'src_split',
      sourceTitle: 'EduSoho教培线用户指南',
      sourceKind: 'whitepaper_docx',
      sourceDocumentPath: 'knowledge/_sources/whitepapers/test.docx',
      normalizedBlocks: blocks,
      maxParentChars: 170,
    });
    assert.equal(result.draftPaths.length > 1, true);
    assert.equal(result.report.uncoveredSourceBlockIds.length, 0);
    for (const draftPath of result.draftPaths) {
      assert.doesNotMatch(readFileSync(draftPath, 'utf8'), /slice-size:exceeded/);
    }
  } finally {
    cleanup(workspace);
  }
});

test('draft slicer keeps single oversized paragraph and records manual split warning', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const blocks = [
      normalizedBlock('src_manual_split', 1, 'heading', '超长段落'),
      normalizedBlock('src_manual_split', 2, 'paragraph', '这是一个无法安全拆开的长段落。'.repeat(40)),
    ];
    const result = buildDraftSlices({
      workspaceRoot: workspace,
      sourceDocumentId: 'src_manual_split',
      sourceTitle: '超长白皮书',
      sourceKind: 'whitepaper_docx',
      normalizedBlocks: blocks,
      maxParentChars: 120,
    });
    assert.equal(result.draftPaths.length, 1);
    assert.equal(result.report.warnings.some((warning) => /manual_split_required/.test(warning)), true);
  } finally {
    cleanup(workspace);
  }
});

test('review approval keeps draft non-active until publish', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const draftsRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_review_semantics');
    mkdirSync(draftsRoot, { recursive: true });
    const draftPath = join(draftsRoot, '001-test.md');
    writeFileSync(draftPath, approvedDraftMarkdown('drf_review_semantics_001', 'draft'), 'utf8');
    const record = reviewDraftSlices({
      workspaceRoot: workspace,
      sourceDocumentId: 'src_review_semantics',
      action: 'approve',
      reviewer: 'tester',
      notes: 'approved',
    });
    const parsed = parseMarkdownDocument(readFileSync(draftPath, 'utf8'), draftPath);
    assert.equal(record.reviewedIds.length, 1);
    assert.equal(parsed.frontmatter.status, 'draft');
    assert.equal(parsed.frontmatter.pipeline_status, 'approved');
    assert.match(parsed.frontmatter.review_id, /^rev_/);
    const evidence = await retrieveEvidence({ workspaceRoot: workspace, query: '测试发布' });
    assert.equal(evidence.results.length, 0);
  } finally {
    cleanup(workspace);
  }
});

test('publish blocks quality error draft', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const draftsRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_quality_error');
    mkdirSync(draftsRoot, { recursive: true });
    writeFileSync(join(draftsRoot, '001-test.md'), approvedDraftMarkdown('drf_quality_error_001', 'approved', 'error'), 'utf8');
    const report = publishApprovedDraftSlices({ workspaceRoot: workspace, sourceDocumentId: 'src_quality_error' });
    assert.equal(report.publishedIds.length, 0);
    assert.deepEqual(report.rejectedIds, ['drf_quality_error_001']);
  } finally {
    cleanup(workspace);
  }
});

test('quality-clean auto approval publishes only slices without warn or error issues', async () => {
  const workspace = tempWorkspace();
  try {
    initKnowledgeWorkspace({ workspaceRoot: workspace });
    const draftsRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_gate');
    mkdirSync(draftsRoot, { recursive: true });
    writeFileSync(join(draftsRoot, '001-clean.md'), approvedDraftMarkdown('clean', 'draft', 'unchecked'), 'utf8');
    writeFileSync(join(draftsRoot, '002-warned.md'), approvedDraftMarkdown('warned', 'draft', 'unchecked'), 'utf8');
    writeFileSync(join(draftsRoot, '003-broken.md'), approvedDraftMarkdown('broken', 'draft', 'unchecked'), 'utf8');
    const report = emptyQualityReport(workspace);
    report.issues = [
      { documentId: 'warned', severity: 'warn', code: 'too_short', message: 'too short' },
      { documentId: 'broken', severity: 'error', code: 'missing_source_blocks', message: 'missing blocks' },
    ];
    report.severityCounts = { info: 0, warn: 1, error: 1 };
    writeKnowledgeQualityReport({ workspaceRoot: workspace, report });

    const approval = approveQualityCleanDraftSlices({
      workspaceRoot: workspace,
      reviewer: 'super-helper-onboarding',
    });
    const published = publishApprovedDraftSlices({ workspaceRoot: workspace, qualityGate: 'strict' });

    assert.deepEqual(approval.approvedIds, ['clean']);
    assert.deepEqual(approval.pendingReviewIds, ['warned']);
    assert.deepEqual(approval.blockedIds, ['broken']);
    assert.deepEqual(published.publishedIds, ['clean']);
  } finally {
    cleanup(workspace);
  }
});




function normalizedBlock(sourceId, order, type, text) {
  return {
    block_id: `nrm_${sourceId}_${String(order).padStart(5, '0')}`,
    source_document_id: sourceId,
    source_block_id: `blk_${sourceId}_${String(order).padStart(5, '0')}`,
    order,
    type,
    text,
    normalized_text: text,
    section_path: ['课程搜索'],
    included_in_slice: true,
  };
}

function approvedDraftMarkdown(id, pipelineStatus, qualityStatus = 'ok') {
  return `---
id: ${id}
title: 测试发布
type: whitepaper_slice
module: general
intent: product_rule
source_type: whitepaper
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms:
  - 测试发布
  - 发布流程
  - 审核流程
related_repos: []
last_verified_at: 2999-01-01
owner: knowledge-admin
source_document: knowledge/_sources/whitepapers/test.docx
source_document_id: src_review_semantics
source_block_ids:
  - blk_review_00001
section_path:
  - 测试发布
chunking_strategy: semantic-section-v2
pipeline_stage: slice
pipeline_status: ${pipelineStatus}
quality_status: ${qualityStatus}
---

# 测试发布

## 核心内容

当审核通过后，知识库发布命令会把通过审核的草稿写入正式知识目录，并保留来源和审核信息。
`;
}

function emptyQualityReport(workspace) {
  return {
    version: 1,
    workspaceRoot: workspace,
    knowledgeRoot: join(workspace, 'knowledge'),
    generatedAt: '2026-06-14T00:00:00.000Z',
    thresholds: {
      minBodyChars: 80,
      maxParentChars: 2800,
      maxUnknownBlockRatio: 0.3,
      minRelatedTerms: 3,
      maxDuplicateNormalizedHashes: 1,
      multiTopicHeadingThreshold: 3,
    },
    inspected: { sourceDocuments: 0, draftSlices: 1, publishedSlices: 0, chunks: 0 },
    stageSummaries: {},
    severityCounts: { info: 0, warn: 0, error: 0 },
    issueCounts: {},
    issues: [],
    recommendedActions: [],
    gate: 'warn',
  };
}
