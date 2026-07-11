import type { SecretRef } from '../domain.js';
import type {
  ExecuteMcpToolInput,
  MaterializedMcpTransportConfig,
  McpExecutionResult,
  McpServerConfig,
} from './contracts.js';
import { normalizeMcpResult } from './normalizer.js';

export async function executeMcpTool(input: ExecuteMcpToolInput): Promise<McpExecutionResult> {
  const rejection = executionRejection(input);
  if (rejection) {
    return { status: 'rejected', reason: rejection };
  }

  const transport = materializeMcpTransportConfig(input.server, input.resolveSecret ?? resolveEnvSecret);
  const timeoutMs = input.server.timeoutMs ?? 15_000;
  let client: Awaited<ReturnType<ExecuteMcpToolInput['createClient']>> | undefined;
  try {
    client = await withTimeout(input.createClient({ server: input.server, transport }), timeoutMs);
    const tools = await withTimeout(client.listTools(), timeoutMs);
    if (!tools.some((tool) => tool.name === input.toolName)) {
      return { status: 'rejected', reason: 'tool_not_discovered' };
    }
    const result = normalizeMcpResult(await withTimeout(
      client.callTool(input.toolName, input.arguments),
      timeoutMs,
    ));
    return { status: 'completed', toolName: input.toolName, result };
  } catch (error) {
    return { status: 'failed', reason: error instanceof McpTimeoutError ? 'timeout' : 'transport_failure' };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

function executionRejection(input: ExecuteMcpToolInput): string | undefined {
  const { server, workspace, toolName } = input;
  if (!server.enabled) return 'server_disabled';
  if (!workspace.mcpToolIds.includes(server.id)) return 'server_not_allowed_for_workspace';
  if (server.permission !== 'read_only') return 'server_not_read_only';
  if (!server.allowedToolNames?.length) return 'tool_allowlist_missing';
  if (!server.allowedToolNames.includes(toolName)) return 'tool_not_allowed';
  if (server.protocol === 'stdio') {
    const command = server.config?.command;
    if (!command) return 'transport_config_invalid';
    if (!input.stdioCommandWhitelist.includes(command)) return 'stdio_command_not_allowed';
  } else if (!server.config?.url) {
    return 'transport_config_invalid';
  }
  return undefined;
}

export function materializeMcpTransportConfig(
  server: McpServerConfig,
  resolveSecret: (ref: SecretRef) => string | undefined,
): MaterializedMcpTransportConfig {
  if (server.protocol === 'stdio') {
    return {
      protocol: 'stdio',
      command: server.config?.command ?? '',
      args: server.config?.args ?? [],
      cwd: server.config?.cwd,
      env: materializeSecretMap(server.config?.env, resolveSecret),
    };
  }
  return {
    protocol: server.protocol,
    url: server.config?.url ?? '',
    headers: materializeSecretMap(server.config?.headers, resolveSecret),
  };
}

function materializeSecretMap(
  values: Record<string, SecretRef> | undefined,
  resolveSecret: (ref: SecretRef) => string | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values ?? {}).flatMap(([key, ref]) => {
      const value = resolveSecret(ref);
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function resolveEnvSecret(ref: SecretRef): string | undefined {
  return ref.source === 'env' ? process.env[ref.name] : undefined;
}

class McpTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new McpTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
