import type { ClaudeWorkerResponse, DiagnosticRequest, DiagnosticResult } from '../../domain.js';
import type { CommandExecution } from './claude-cli.js';
import { normalizeWorkerDiagnosticResult } from './worker-result-normalizer.js';

export function parseClaudeOutput(stdout: string, request: DiagnosticRequest): DiagnosticResult {
  try {
    const outer = JSON.parse(stdout) as { result?: string; type?: string; subtype?: string; errors?: unknown[] } | DiagnosticResult;
    if ('type' in outer && outer.type === 'result' && outer.subtype && outer.subtype !== 'success') {
      return {
        status: 'partial',
        summary: `Claude Code returned ${outer.subtype} before producing a DiagnosticResult.`,
        missingInfo: [],
        evidence: [
          {
            id: 'ev_worker_result_subtype',
            kind: 'log',
            source: request.runId,
            summary: stdout.slice(0, 1000),
            confidence: 'low',
          },
        ],
        claims: [
          {
            type: 'unknown',
            role: 'unknown',
            text: `Claude Code did not complete the requested analysis: ${outer.subtype}.`,
            evidenceIds: ['ev_worker_result_subtype'],
            answers: [],
          },
        ],
        recommendedNextAction: 'continue_diagnosis',
      };
    }
    const text = 'result' in outer && typeof outer.result === 'string' ? outer.result : JSON.stringify(outer);
    const jsonText = extractFirstJsonObjectText(text);
    return normalizeWorkerDiagnosticResult(
      JSON.parse(jsonText) as DiagnosticResult,
      request,
    );
  } catch {
    return {
      status: 'partial',
      summary: 'Claude Code returned output, but super helper could not parse it as structured JSON.',
      missingInfo: [],
      evidence: [
        {
          id: 'ev_raw_worker_output',
          kind: 'unknown',
          source: request.runId,
          summary: stdout.slice(0, 1000),
          confidence: 'low',
        },
      ],
        claims: [
          {
            type: 'unknown',
            role: 'unknown',
            text: 'Worker output needs manual review before it can become a conclusion.',
            evidenceIds: ['ev_raw_worker_output'],
            answers: [],
          },
        ],
      recommendedNextAction: 'escalate_to_human',
    };
  }
}

export function mockDiagnosticResult(request: DiagnosticRequest, reason: string): DiagnosticResult {
  return {
    status: 'partial',
    summary: '已生成一次安全的模拟诊断结果；真实 Claude Code 调用未完成。',
    missingInfo: request.unknowns,
    evidence: [
      {
        id: 'ev_preflight',
        kind: 'manual',
        source: request.runId,
        summary: reason,
        confidence: 'low',
      },
    ],
    claims: [
      {
        type: 'assumption',
        role: 'process_note',
        text: '当前只能说明 helper agent 已经完成预检，尚不能最终定位问题。',
        evidenceIds: ['ev_preflight'],
        answers: [],
      },
    ],
    recommendedNextAction: request.unknowns.length > 0 ? 'ask_user' : 'continue_diagnosis',
  };
}

export function failedExecutionDiagnosticResult(request: DiagnosticRequest, execution: CommandExecution): DiagnosticResult {
  const reason = extractExecutionFailureReason(execution);
  const executionParts = [
    execution.exitCode !== undefined ? `exitCode=${execution.exitCode}` : '',
    execution.signal ? `signal=${execution.signal}` : '',
    execution.error ? `error=${execution.error}` : '',
  ].filter(Boolean);
  const evidenceSummary = [
    'Claude Code CLI 未完成本轮诊断',
    executionParts.join(', '),
    reason ? `原因：${reason}` : '',
  ].filter(Boolean).join('；');

  return {
    status: 'partial',
    summary: `Claude Code 调用失败：${reason}`,
    missingInfo: [],
    evidence: [
      {
        id: 'ev_claude_cli_failure',
        kind: 'log',
        source: request.runId,
        summary: evidenceSummary,
        confidence: 'high',
      },
    ],
    claims: [
      {
        type: 'fact',
        role: 'process_note',
        text: 'Claude Code 没有完成模型推理或只读工具调用，因此本轮没有产生可用于回答用户问题的代码证据。',
        evidenceIds: ['ev_claude_cli_failure'],
        answers: [],
      },
      {
        type: 'unknown',
        role: 'unknown',
        text: `仍无法回答：${request.userGoal}`,
        evidenceIds: ['ev_claude_cli_failure'],
        answers: [],
      },
    ],
    recommendedNextAction: 'escalate_to_human',
  };
}

export function mockDiagnosticResponse(request: DiagnosticRequest, reason: string, startedAt: string): ClaudeWorkerResponse {
  return {
    result: mockDiagnosticResult(request, reason),
    trace: {
      command: 'claude worker not executed',
      cwd: '',
      stdout: '',
      stderr: '',
      error: reason,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
  };
}

function extractExecutionFailureReason(execution: CommandExecution): string {
  const parsedStdoutReason = extractClaudeResultMessage(execution.stdout);
  if (parsedStdoutReason) {
    return parsedStdoutReason;
  }

  const stderr = execution.stderr.trim();
  if (stderr) {
    return stderr.slice(0, 1000);
  }

  if (execution.error) {
    return execution.error;
  }

  if (execution.signal) {
    return `process ended with ${execution.signal}`;
  }

  return 'unknown worker failure';
}

function extractClaudeResultMessage(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: unknown; subtype?: unknown };
    if (typeof parsed.result === 'string' && parsed.result.trim()) {
      return parsed.result.trim();
    }
    if (parsed.is_error && typeof parsed.subtype === 'string') {
      return parsed.subtype;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function extractFirstJsonObjectText(text: string): string {
  const fenced = extractFencedJsonObjectText(text);
  if (fenced) {
    return fenced;
  }

  const trimmed = text.trim();
  if (isJsonObject(trimmed)) {
    return trimmed;
  }

  return scanForJsonObjectText(text) ?? text;
}

function extractFencedJsonObjectText(text: string): string | undefined {
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fencePattern)) {
    const candidate = match[1]?.trim() ?? '';
    if (isJsonObject(candidate)) {
      return candidate;
    }
    const nested = scanForJsonObjectText(candidate);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function scanForJsonObjectText(text: string): string | undefined {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const candidate = balancedObjectAt(text, start);
    if (candidate && isJsonObject(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function balancedObjectAt(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function isJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
