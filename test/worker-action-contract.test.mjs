import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClaudeSystemPrompt } from '../dist/workers/claude/claude-prompts.js';
import { parseClaudeOutput } from '../dist/workers/claude/claude-output-parser.js';

const request = {
  caseId: 'case_gate_b',
  runId: 'run_gate_b',
  workspaceId: 'current',
  answerGoal: {
    rawUserQuestion: '如何开启 X，以及多久生效？',
    resolvedQuestion: '如何开启 X，以及多久生效？',
    answerObject: 'X',
    mustAnswerItems: ['如何开启 X', '多久生效'],
    diagnosticObjective: '检查配置',
    sourceMessageIds: ['msg_gate_b'],
  },
  userGoal: '如何开启 X，以及多久生效？',
  knownFacts: [],
  unknowns: [],
  constraints: [],
  allowedMcpToolIds: [],
};

test('Gate B worker prompt requires evidence-bound actionable claims and explicit action safety', () => {
  const prompt = buildClaudeSystemPrompt();
  assert.match(prompt, /role "next_action"/);
  assert.match(prompt, /actionSafety/);
  assert.match(prompt, /executionStatus/);
  assert.match(prompt, /requires_authorization/);
  assert.match(prompt, /must not claim.*executed/i);
  assert.match(prompt, /Read, Glob, Grep/);
  assert.match(
    prompt,
    /every .*mustAnswerItems.*MUST return status "concluded".*recommendedNextAction "final_answer"/i,
  );
});

test('Gate B worker parser keeps only exact current item identities', () => {
  const result = parseClaudeOutput(JSON.stringify({
    status: 'concluded',
    summary: '已确认',
    missingInfo: [],
    evidence: [{ id: 'ev_1', kind: 'workspace', source: 'config', summary: '配置证据', confidence: 'high' }],
    claims: [{
      id: 'claim_1',
      type: 'fact',
      role: 'primary_answer',
      text: '开启方式已确认。',
      evidenceIds: ['ev_1'],
      answers: ['如何开启 X', '伪造的别名'],
    }],
    recommendedNextAction: 'final_answer',
  }), request);
  assert.deepEqual(result.claims[0].answers, ['如何开启 X']);
});

test('Gate B worker parser preserves exact item identities for relevant supporting context', () => {
  const result = parseClaudeOutput(JSON.stringify({
    status: 'partial',
    summary: '线索',
    missingInfo: [],
    evidence: [{ id: 'ev_1', kind: 'workspace', source: 'src/config.ts:1-1', summary: '配置证据', confidence: 'high' }],
    claims: [{
      id: 'support_1',
      type: 'fact',
      role: 'supporting_context',
      text: '当前配置文件存在该键。',
      evidenceIds: ['ev_1'],
      answers: ['如何开启 X', '伪造的别名'],
    }],
    recommendedNextAction: 'continue_diagnosis',
  }), request);

  assert.deepEqual(result.claims[0].answers, ['如何开启 X']);
});

test('Gate B worker parser rejects unstructured actions and marks authorized actions as pending', () => {
  const base = {
    status: 'partial',
    summary: '建议',
    missingInfo: [],
    evidence: [{ id: 'ev_1', kind: 'workspace', source: 'config', summary: '配置证据', confidence: 'high' }],
    recommendedNextAction: 'continue_diagnosis',
  };
  const result = parseClaudeOutput(JSON.stringify({
    ...base,
    claims: [
      {
        id: 'unstructured',
        type: 'inference',
        role: 'next_action',
        text: '修改配置。',
        evidenceIds: ['ev_1'],
        answers: ['如何开启 X'],
      },
      {
        id: 'authorized',
        type: 'inference',
        role: 'next_action',
        text: '由人工修改配置。',
        evidenceIds: ['ev_1'],
        answers: ['如何开启 X'],
        actionSafety: 'requires_authorization',
        executionStatus: 'proposed',
      },
    ],
  }), request);

  assert.deepEqual(result.claims.map((claim) => claim.id), ['authorized']);
  assert.match(result.claims[0].text, /^待人工授权：/);
  assert.deepEqual(result.claims[0].answers, ['如何开启 X']);
});
