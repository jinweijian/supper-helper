import { spawnSync } from 'node:child_process';
import { ensureConfig } from '../dist/config.js';
import { startServer } from '../dist/gateway/http-server.js';
import {
  readActiveKnowledgeGeneration,
} from '../dist/knowledge/generation-store.js';
import { resolveKnowledgeWorkspaceRoot } from '../dist/knowledge/index.js';
import {
  assertAcceptancePollResponse,
  createMonotonicDeadline,
  describeWorkerExecutionFailure,
  resolveRealAcceptanceTimeoutMs,
  shouldRetryAcceptancePoll,
} from './acceptance-time.mjs';

const acceptanceEnabled = process.env.SUPER_HELPER_REAL_ACCEPTANCE === '1';
if (!acceptanceEnabled) {
  console.log(JSON.stringify({
    overall: 'NOT_RUN',
    reason: 'SUPER_HELPER_REAL_ACCEPTANCE=1 is required',
  }, null, 2));
  process.exit(0);
}

const config = ensureConfig();
const workspace = config.workspaces[0];
const modelProvider = config.agent.modelProvider
  ? config.models.providers[config.agent.modelProvider]
  : undefined;
const independentReviewsConfigured = Boolean(
  modelProvider && config.agent.useModelForPreflight,
);
const knowledgeWorkspaceRoot = resolveKnowledgeWorkspaceRoot(config, workspace?.id);
const activeGeneration = readActiveKnowledgeGeneration(knowledgeWorkspaceRoot);
const checks = [];

record(
  'real_agent_model',
  independentReviewsConfigured ? 'PASS' : 'NOT_RUN',
  independentReviewsConfigured
    ? 'configured provider will serve preflight and independent reviewers'
    : 'agent model provider/preflight review is not configured',
);
record(
  'real_embedding',
  config.embedding.enabled ? 'PASS' : 'NOT_RUN',
  config.embedding.enabled ? 'configured embedding is enabled' : 'embedding is disabled',
);
record(
  'real_rerank',
  config.rerank.enabled ? 'PASS' : 'NOT_RUN',
  config.rerank.enabled ? 'configured rerank is enabled' : 'rerank is disabled',
);
record(
  'real_knowledge_v4',
  activeGeneration ? 'PASS' : 'FAIL',
  activeGeneration ? `active generation ${activeGeneration.generation_id}` : 'active v4 generation is unavailable',
);

const claudeAvailable = config.claude.enabled && spawnSync(
  config.claude.command,
  ['--version'],
  { encoding: 'utf8', timeout: 10_000 },
).status === 0;
record(
  'real_claude_worker',
  claudeAvailable ? 'PASS' : 'FAIL',
  claudeAvailable ? 'configured Claude command is available' : 'configured Claude command is unavailable',
);

if (!workspace || !activeGeneration || !claudeAvailable) {
  finish();
}

const serverConfig = structuredClone(config);
serverConfig.server.host = '127.0.0.1';
serverConfig.server.port = 0;
let server;
let caseId;

try {
  server = await startServer({ config: serverConfig });
  const accepted = await fetch(`${server.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      async: true,
      persona: 'developer',
      workspaceId: workspace.id,
      message: [
        '请只读检查这个项目并分别回答两个问题：',
        '1. package.json 中 acceptance:answer-fidelity:real 对应什么命令？',
        '2. src/runtime/safe-answer-renderer.ts 中整份回复安全扫描由哪个函数执行？',
        '请给出对应文件的代码证据，不要修改任何文件。',
      ].join(''),
    }),
  });
  const acceptedBody = await accepted.json();
  caseId = acceptedBody.caseId;
  if (accepted.status !== 202 || !caseId) {
    record('real_chat_acceptance', 'FAIL', `unexpected HTTP status ${accepted.status}`);
    throw new Error('real chat request was not accepted');
  }
  record('real_chat_acceptance', 'PASS', 'real async chat request accepted');

  const session = await waitForFormalReply(server.url, caseId);
  const run = session?.runs?.at(-1);
  const reply = session?.messages?.at(-1)?.body ?? '';
  const workerPassed = run?.workerTrace?.exitCode === 0 && !run?.workerTrace?.error;
  record(
    'real_worker_execution',
    workerPassed ? 'PASS' : 'FAIL',
    workerPassed
      ? 'real worker completed with exit code 0'
      : describeWorkerExecutionFailure(run?.workerTrace),
  );

  const registrationAnswered = [
    'acceptance:answer-fidelity:real',
    'package.json',
  ].every((marker) => reply.includes(marker));
  const unavailableReviewAnswered = [
    'src/runtime/safe-answer-renderer.ts',
    'wholeReplySafetyScan',
  ].every((marker) => reply.includes(marker));
  const completeAnswer = registrationAnswered && unavailableReviewAnswered;
  const missingObligations = [
    ...(!registrationAnswered ? ['registration'] : []),
    ...(!unavailableReviewAnswered ? ['unavailable_review_behavior'] : []),
  ];
  record(
    'answer_obligation_coverage',
    completeAnswer ? 'PASS' : 'FAIL',
    completeAnswer
      ? 'registration and unavailable-review behavior each include bounded code evidence'
      : `missing obligations: ${missingObligations.join(',')}`,
  );

  const forbiddenMarker = findForbiddenReplyMarker(reply);
  const safeReply = forbiddenMarker === undefined;
  record(
    'visible_reply_safety',
    safeReply ? 'PASS' : 'FAIL',
    safeReply
      ? 'reply contains no secret, trace, payload, or sentinel marker'
      : `reply exposed forbidden marker category: ${forbiddenMarker}`,
  );

  const finalAnswer = session.status === 'concluded' &&
    run?.status === 'concluded' &&
    run?.result?.status === 'concluded' &&
    run?.result?.recommendedNextAction === 'final_answer';
  const logResponse = await fetch(
    `${server.url}/api/logs?caseId=${encodeURIComponent(caseId)}`,
  );
  const logBody = await logResponse.json();
  const validationEvent = logBody.blocks?.find?.(
    (event) => event.phase === 'evidence_validation_result',
  );
  const validationDetail = validationEvent?.detail;
  const reviewReason = [
    ...(Array.isArray(validationDetail?.globalBlockerCodes)
      ? validationDetail.globalBlockerCodes
      : []),
    ...(typeof validationDetail?.outcomeReasonCode === 'string'
      ? [validationDetail.outcomeReasonCode]
      : []),
  ].slice(0, 8).join(',');
  record(
    'reviewed_final_answer',
    finalAnswer ? 'PASS' : 'FAIL',
    finalAnswer
      ? 'runtime persisted a reviewed final answer'
      : [
          `runtime outcome remained ${session.status}/${run?.status ?? 'missing'}`,
          `result=${run?.result?.status ?? 'missing'}/${run?.result?.recommendedNextAction ?? 'missing'}`,
          `claims=${run?.result?.claims?.length ?? 0}`,
          `evidence=${run?.result?.evidence?.length ?? 0}`,
          `items=${run?.request?.answerGoal?.mustAnswerItems?.length ?? 0}`,
          `review=${reviewReason || 'unavailable'}`,
        ].join('; '),
  );
} catch (error) {
  record(
    'real_runtime_e2e',
    'FAIL',
    `bounded error: ${boundedError(error)}`,
  );
} finally {
  if (server && caseId) {
    try {
      const deleted = await fetch(
        `${server.url}/api/session?caseId=${encodeURIComponent(caseId)}`,
        { method: 'DELETE' },
      );
      record(
        'acceptance_case_cleanup',
        deleted.ok ? 'PASS' : 'FAIL',
        deleted.ok ? 'acceptance case deleted' : `cleanup returned HTTP ${deleted.status}`,
      );
    } catch (error) {
      record('acceptance_case_cleanup', 'FAIL', `bounded error: ${boundedError(error)}`);
    }
  }
  if (server) {
    try {
      await server.close();
    } catch (error) {
      record('acceptance_server_cleanup', 'FAIL', `bounded error: ${boundedError(error)}`);
    }
  }
}

finish();

async function waitForFormalReply(baseUrl, targetCaseId) {
  const configuredTimeout = resolveRealAcceptanceTimeoutMs(
    config.claude.timeoutMs,
    process.env.SUPER_HELPER_REAL_ACCEPTANCE_TIMEOUT_MS,
  );
  const deadline = createMonotonicDeadline(configuredTimeout);
  let latest;
  while (!deadline.expired()) {
    try {
      const response = await fetch(
        `${baseUrl}/api/session?caseId=${encodeURIComponent(targetCaseId)}&includeKnowledgeHealth=false`,
      );
      assertAcceptancePollResponse(response);
      const body = await response.json();
      latest = body.session;
    } catch (error) {
      if (!shouldRetryAcceptancePoll(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    const run = latest?.runs?.at(-1);
    const lastMessage = latest?.messages?.at(-1);
    if (
      run &&
      run.status !== 'running' &&
      run.status !== 'pending' &&
      lastMessage?.role === 'helper'
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('real acceptance timed out before a formal helper reply');
}

function record(id, status, detail) {
  checks.push({ id, status, detail });
}

function boundedError(error) {
  const value = error instanceof Error ? error.message : String(error);
  return Array.from(value.replace(/(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)/gi, '[REDACTED]'))
    .slice(0, 160)
    .join('');
}

function findForbiddenReplyMarker(value) {
  const markers = [
    ['secret_key', /sk-[A-Za-z0-9_-]{12,}/i],
    ['bearer_token', /Bearer\s+\S+/i],
    ['worker_trace', /worker[_ -]?trace/i],
    ['provider_payload', /provider[_ -]?payload/i],
    ['compatibility_sentinel', /direct_answer/i],
  ];
  return markers.find(([, pattern]) => pattern.test(value))?.[0];
}

function finish() {
  const overall = checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL';
  console.log(JSON.stringify({ overall, checks }, null, 2));
  process.exit(overall === 'PASS' ? 0 : 2);
}
