import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
let pendingRestore;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    pendingRestore?.();
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
  });
}

const build = spawnSync('pnpm', ['build'], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});
if (build.status !== 0) {
  process.stderr.write(build.stdout);
  process.stderr.write(build.stderr);
  process.exit(build.status ?? 1);
}

const mutations = [
  {
    name: 'supporting rejection cannot become a result-global blocker',
    file: 'dist/runtime/result-validator.js',
    from: 'const coverageComplete = acceptedPrimaryAnswerClaimIds.length > 0;',
    to: `const coverageComplete = acceptedPrimaryAnswerClaimIds.length > 0;
    if (input.structural.rejectedClaimIds.length > 0) globalBlockers.push({ code: 'mutated_rejection_coupling' });`,
    tests: ['test/answer-fidelity-gate-a.test.mjs'],
    expectedFailure: /invalid supporting claim is local rejection/,
  },
  {
    name: 'producer answers cannot self-certify coverage',
    file: 'dist/runtime/answer-coverage.js',
    from: 'export function selectFrozenPrimaryClaimIds(input) {',
    to: `export function selectFrozenPrimaryClaimIds(input) {
    return input.claims.filter((claim) => claim.role === 'primary_answer' &&
        input.answerGoal.mustAnswerItems.every((item) => claim.answers.includes(item))).map((claim) => claim.id);`,
    tests: ['test/answer-fidelity-gate-a.test.mjs'],
    expectedFailure: /producer over-label/,
  },
  {
    name: 'proposer output cannot self-certify completeness',
    file: 'dist/runtime/answer-goal-reconciliation.js',
    from: 'const review = input.completenessReview;',
    to: `const review = { status: 'complete', missingElements: [] };`,
    tests: ['test/answer-goal-gate-b.test.mjs'],
    expectedFailure: /proposer-self-certified/,
  },
  {
    name: 'fullQuestionClaimIds cannot be ignored',
    file: 'dist/runtime/answer-coverage.js',
    from: `for (const claim of eligible) {
        if (input.review.fullQuestionClaimIds.includes(claim.id) && !selected.includes(claim.id)) {
            selected.push(claim.id);
        }
    }`,
    to: 'for (const claim of eligible) { void claim; }',
    tests: ['test/answer-fidelity-gate-a.test.mjs'],
    expectedFailure: /frozen primary order/,
  },
  {
    name: 'stale or unvalidated evidence cannot enter coverage',
    file: 'dist/runtime/coverage-evidence-provenance.js',
    from: 'function eligibleEnvelope(envelope, currentRunId, currentMessageIds) {',
    to: `function eligibleEnvelope(envelope, currentRunId, currentMessageIds) {
    return true;`,
    tests: ['test/answer-fidelity-provenance.test.mjs'],
    expectedFailure: /stale or mismatched worker envelopes/,
  },
  {
    name: 'prompt-safety review cannot be bypassed',
    file: 'dist/runtime/safe-answer-projection.js',
    from: `const acceptedPromptIds = new Set(promptReview?.status === 'accepted' ? promptReview.acceptedIds : []);`,
    to: `const acceptedPromptIds = new Set(promptCandidates.map((item) => item.id));`,
    tests: [
      'test/answer-fidelity-presentation.test.mjs',
      'test/turn-presentation-integrity.test.mjs',
    ],
    expectedFailure: /unreviewed opaque prompts|prompt-safety seam is unavailable/,
  },
  {
    name: 'renderer cannot regain a raw DiagnosticResult entrypoint',
    file: 'src/runtime/presenter.ts',
    from: 'export {',
    to: `import type { DiagnosticResult } from '../domain.js';
export function mutatedRawPresenter(_result: DiagnosticResult): string { return 'unsafe'; }
export {`,
    tests: ['test/answer-fidelity-provenance.test.mjs'],
    expectedFailure: /presenter boundary/,
  },
  {
    name: 'Experience cannot replay without a current resolver',
    file: 'dist/runtime/experience-agent.js',
    from: `if (!currentEvidenceResolver)
        return { reason: 'current_evidence_resolver_unavailable' };`,
    to: `if (!currentEvidenceResolver)
        return { result, coverageEvidenceEnvelopes: [] };`,
    tests: ['test/answer-goal-gate-b.test.mjs'],
    expectedFailure: /Experience replays structured claims only after an exact goal and current resolver/,
  },
  {
    name: 'Experience identity cannot compare sentinel alone',
    file: 'dist/runtime/experience-agent.js',
    from: 'export function hasExactExperienceAnswerGoal(current, source) {',
    to: `export function hasExactExperienceAnswerGoal(current, source) {
    if (current.mustAnswerItems.includes('direct_answer') && source.mustAnswerItems.includes('direct_answer')) return true;`,
    tests: ['test/answer-goal-gate-b.test.mjs'],
    expectedFailure: /Experience exact-goal identity/,
  },
  {
    name: 'Experience knowledge revalidation cannot skip active-generation recheck',
    file: 'src/runtime/knowledge-experience-resolver.ts',
    from: 'currentGeneration?.generation_id !== activeGeneration.generation_id ||',
    to: 'false ||',
    tests: ['test/answer-goal-gate-b.test.mjs'],
    expectedFailure: /Knowledge Experience revalidation pins/,
  },
  {
    name: 'embedding cannot use canonical text instead of retrieval text',
    file: 'dist/knowledge/vector-index.js',
    from: 'text: chunk.retrieval_text ?? chunk.text,',
    to: 'text: chunk.text,',
    tests: ['test/knowledge-v4.test.mjs'],
    expectedFailure: /v4 separates canonical body from retrieval text/,
  },
  {
    name: 'persisted legacy=false cannot make pre-v4 chunks current',
    file: 'dist/knowledge/documents/chunk-utils.js',
    from: 'return { ...chunk, legacy: !current };',
    to: 'return { ...chunk, legacy: chunk.legacy ?? !current };',
    tests: ['test/knowledge-v4.test.mjs'],
    expectedFailure: /reader marks every non-v4 child legacy/,
  },
  {
    name: 'undersized children cannot become direct or embedding eligible',
    file: 'dist/knowledge/vector-index.js',
    from: 'if (chunk.undersized_unmergeable || chunk.manual_split_required) {',
    to: 'if (false && (chunk.undersized_unmergeable || chunk.manual_split_required)) {',
    tests: ['test/knowledge-v4.test.mjs'],
    expectedFailure: /undersized trailing child/,
  },
  {
    name: 'publisher expected-active CAS cannot be removed',
    file: 'dist/knowledge/generation-store.js',
    from: `function assertExpectedActive(workspaceRoot, expected) {
    if (readActiveKnowledgeGeneration(workspaceRoot)?.generation_id !== expected) {
        throw new KnowledgeGenerationConflictError('generation_conflict');
    }
}`,
    to: `function assertExpectedActive(workspaceRoot, expected) {
    void workspaceRoot;
    void expected;
}`,
    tests: ['test/knowledge-v4.test.mjs'],
    expectedFailure: /generation activation is atomic/,
  },
  {
    name: 'answer span cannot truncate an incomplete answer to 500 code points',
    file: 'dist/retrieval/answer-span.js',
    from: 'export function selectAnswerSpan(input) {',
    to: `export function selectAnswerSpan(input) {
    return Array.from(input.text).slice(0, 500).join('');`,
    tests: ['test/knowledge-v4.test.mjs'],
    expectedFailure: /answer span abstains/,
  },
];

for (const mutation of mutations) {
  const path = resolve(root, mutation.file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(mutation.from)) {
    throw new Error(`Mutation target not found: ${mutation.name} (${mutation.file})`);
  }
  const mutated = original.replace(mutation.from, mutation.to);
  try {
    pendingRestore = () => writeFileSync(path, original, 'utf8');
    writeFileSync(path, mutated, 'utf8');
    const result = spawnSync(process.execPath, ['--test', ...mutation.tests], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !mutation.expectedFailure.test(output)) {
      process.stderr.write(output);
      throw new Error(`Mutation was not killed by its expected focused test: ${mutation.name}`);
    }
    process.stdout.write(`MUTATION_KILLED ${mutation.name}\n`);
  } finally {
    writeFileSync(path, original, 'utf8');
    pendingRestore = undefined;
  }
}

process.stdout.write(`Mutation audit passed: ${mutations.length}/${mutations.length} killed.\n`);
