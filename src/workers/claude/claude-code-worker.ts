import type { SuperHelperConfig } from '../../config.js';
import type { ClaudeWorkerResponse, DiagnosticRequest, WorkerTrace } from '../../domain.js';
import type { DiagnosticWorker } from '../diagnostic-worker.js';
import { runCommandWithSessionBusyRetry, shellCommand } from './claude-cli.js';
import { failedExecutionDiagnosticResult, mockDiagnosticResponse, parseClaudeOutput } from './claude-output-parser.js';
import { buildClaudeSystemPrompt, buildClaudeUserPrompt } from './claude-prompts.js';
import { assertHostCommandAllowed, DEFAULT_DISALLOWED_CLAUDE_TOOLS, readOnlyTools } from './claude-policy.js';
import { currentWorkerCoverageEvidence } from './coverage-evidence.js';

export class ClaudeCodeWorker implements DiagnosticWorker {
  private static readonly sessionQueues = new Map<string, Promise<void>>();

  constructor(private readonly config: SuperHelperConfig) {}

  async diagnose(request: DiagnosticRequest): Promise<ClaudeWorkerResponse> {
    return this.withSessionLock(request.claudeSessionId, () => this.diagnoseUnlocked(request));
  }

  private async diagnoseUnlocked(request: DiagnosticRequest): Promise<ClaudeWorkerResponse> {
    const startedAt = new Date().toISOString();
    if (!this.config.claude.enabled) {
      return mockDiagnosticResponse(request, 'Claude Code worker disabled in config.', startedAt);
    }

    const workspace = this.config.workspaces.find((item) => item.id === request.workspaceId);
    if (!workspace) {
      return mockDiagnosticResponse(request, `Workspace ${request.workspaceId} not found.`, startedAt);
    }

    const commandAllowed = assertHostCommandAllowed(this.config.claude.command, this.config.claude.commandWhitelist);
    if (commandAllowed) {
      return mockDiagnosticResponse(request, commandAllowed, startedAt);
    }

    const systemPrompt = buildClaudeSystemPrompt();
    const userPrompt = buildClaudeUserPrompt(request);
    const allowedTools = readOnlyTools(this.config.claude.allowedTools ?? this.config.claude.tools);
    const disallowedTools = Array.from(
      new Set([...(this.config.claude.disallowedTools ?? DEFAULT_DISALLOWED_CLAUDE_TOOLS), ...DEFAULT_DISALLOWED_CLAUDE_TOOLS]),
    );
    const args = [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      this.config.claude.permissionMode,
      '--tools',
      allowedTools.join(','),
      '--allowedTools',
      allowedTools.join(','),
      '--disallowedTools',
      disallowedTools.join(' '),
      '--system-prompt',
      systemPrompt,
      ...sessionArgs(request),
      userPrompt,
    ];
    const maxBudgetUsd = this.config.claude.maxBudgetUsd;
    if (Number.isFinite(maxBudgetUsd) && Number(maxBudgetUsd) > 0) {
      args.splice(3, 0, '--max-budget-usd', String(maxBudgetUsd));
    }
    const command = shellCommand(this.config.claude.command, args);

    const execution = await runCommandWithSessionBusyRetry(
      this.config.claude.command,
      args,
      workspace.rootPath,
      this.config.claude.timeoutMs,
      this.config.claude.sessionBusyMaxRetries ?? 3,
      this.config.claude.sessionBusyRetryDelayMs ?? 3_000,
    );
    const trace: WorkerTrace = {
      command,
      cwd: workspace.rootPath,
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      signal: execution.signal,
      error: execution.error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };

    if (execution.exitCode !== 0 || execution.signal || execution.error) {
      return {
        result: failedExecutionDiagnosticResult(request, execution),
        trace,
      };
    }

    const result = parseClaudeOutput(execution.stdout, request);
    return {
      result,
      trace,
      coverageEvidence: currentWorkerCoverageEvidence(request, result, workspace.rootPath),
    };
  }

  private async withSessionLock<T>(claudeSessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = ClaudeCodeWorker.sessionQueues.get(claudeSessionId) ?? Promise.resolve();
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    ClaudeCodeWorker.sessionQueues.set(claudeSessionId, current);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release!();
      if (ClaudeCodeWorker.sessionQueues.get(claudeSessionId) === current) {
        ClaudeCodeWorker.sessionQueues.delete(claudeSessionId);
      }
    }
  }
}

function sessionArgs(request: DiagnosticRequest): string[] {
  return request.runId === 'run_01'
    ? ['--session-id', request.claudeSessionId]
    : ['--resume', request.claudeSessionId];
}
