import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../../../dist/config.js';
import { startServer } from '../../../dist/gateway/http-server.js';

const root = mkdtempSync(join(tmpdir(), 'super-helper-web-e2e-'));
const workspace = join(root, 'workspace');
mkdirSync(workspace, { recursive: true });
const config = defaultConfig();
config.server.host = '127.0.0.1';
config.server.port = 44317;
config.storage.rootDir = root;
config.knowledge.rootDir = join(root, 'knowledge');
config.workspaces = [{ id: 'current', name: 'E2E Workspace', rootPath: workspace, mcpToolIds: [] }];
config.onboarding.completedAt = new Date().toISOString();
config.agent.useModelForPreflight = false;
config.agent.useModelForRagAnswerability = false;
config.agent.modelProvider = undefined;
config.claude.enabled = false;

let reviewRequired = true;
let draft = null;
let run;
const subscribers = new Set();
const onboarding = {
  getState: () => ({ completed: true, needsReview: false, draft, latestRun: run, review: reviewState() }),
  async saveDraft(input) { draft = input.draft; return this.getState(); },
  async validateDraft() { return { ok: true, issues: [] }; },
  getReviewState() { return reviewState(); },
  async submitReview(input) {
    const ids = [...(input.ids ?? [])].sort();
    if (ids.join(',') !== 'review_1,review_2') throw new Error('review requires explicit current-page ids');
    reviewRequired = false;
    return { review: reviewState(), publishedSlices: 2, indexedDocuments: 2, indexedChunks: 2 };
  },
  async startRun() {
    run = makeRun('failed');
    queueMicrotask(() => publish('run.failed'));
    return run;
  },
  getRun(id) { return run?.id === id ? run : undefined; },
  async retryRun(id) {
    if (run?.id !== id) throw new Error('run not found');
    run = makeRun('completed');
    queueMicrotask(() => publish('run.completed'));
    return run;
  },
  subscribe(_id, listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
};

function reviewState() {
  const items = [
    reviewItem('review_1', '登录知识切片', '内容摘要：登录失败时先核对账号状态。'),
    reviewItem('review_2', '退款知识切片', '退款申请需要提供订单编号和退款原因。'),
  ];
  return {
    required: reviewRequired,
    pendingCount: reviewRequired ? 2 : 0,
    blockedCount: 0,
    totalCount: reviewRequired ? 2 : 0,
    page: { offset: 0, limit: 20, total: reviewRequired ? 2 : 0, returned: reviewRequired ? 2 : 0, hasMore: false, severity: 'all', search: '' },
    items: reviewRequired ? items : [],
  };
}
function reviewItem(id, title, excerptPreview) {
  return {
    id,
    sourceDocumentId: `doc_${id}`,
    title,
    module: 'demo',
    path: `knowledge/${id}.md`,
    qualitySeverity: 'warn',
    qualityStatus: 'warn',
    pipelineStatus: 'review_required',
    excerptPreview,
    issues: [{
      code: 'short_content',
      severity: 'warn',
      message: '内容较短',
      explanation: {
        reason: '原因：内容较短，需要人工确认是否足以回答问题。',
        impact: '影响：未经确认的内容可能无法覆盖用户问题。',
        suggestion: '建议：确认结论、适用范围与操作步骤。',
        missingInfo: ['适用版本'],
      },
    }],
  };
}
function makeRun(status) {
  return {
    id: 'run_web_e2e', status, draftRevision: 1, overallProgress: status === 'completed' ? 100 : 35,
    stages: [{ id: 'validate_draft', status: status === 'completed' ? 'completed' : 'failed', progress: status === 'completed' ? 100 : 35 }],
    counters: { autoPublished: 0, reviewRequired: 1, blocked: 0 },
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...(status === 'failed' ? { retryableStage: 'validate_draft', safeError: { code: 'fixture', message: '可重试的验收故障', retryable: true } } : {}),
  };
}
function publish(type) { for (const listener of subscribers) listener({ type, runId: run.id, at: new Date().toISOString(), run }); }

const server = await startServer({ config, onboarding });
async function stop() { await server.close(); rmSync(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log(server.url);
