import type { SecretRef, WorkspaceConfig } from '../domain.js';

interface McpServerBase {
  id: string;
  name: string;
  permission: 'read_only' | 'read_write';
  enabled: boolean;
  allowedToolNames?: string[];
  timeoutMs?: number;
}

export interface StdioMcpServerConfig extends McpServerBase {
  protocol: 'stdio';
  config?: {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, SecretRef>;
  };
}

export interface RemoteMcpServerConfig extends McpServerBase {
  protocol: 'http' | 'sse';
  config?: {
    url?: string;
    headers?: Record<string, SecretRef>;
  };
}

export type McpServerConfig = StdioMcpServerConfig | RemoteMcpServerConfig;

export interface MaterializedStdioConfig {
  protocol: 'stdio';
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface MaterializedRemoteConfig {
  protocol: 'http' | 'sse';
  url: string;
  headers: Record<string, string>;
}

export type MaterializedMcpTransportConfig = MaterializedStdioConfig | MaterializedRemoteConfig;

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpClientPort {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, argumentsValue: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export type McpClientFactory = (input: {
  server: McpServerConfig;
  transport: MaterializedMcpTransportConfig;
}) => Promise<McpClientPort>;

export interface ExecuteMcpToolInput {
  server: McpServerConfig;
  workspace: Pick<WorkspaceConfig, 'id' | 'mcpToolIds'>;
  toolName: string;
  arguments: Record<string, unknown>;
  stdioCommandWhitelist: string[];
  createClient: McpClientFactory;
  resolveSecret?: (ref: SecretRef) => string | undefined;
}

export type McpExecutionResult =
  | { status: 'rejected'; reason: string }
  | { status: 'completed'; toolName: string; result: unknown }
  | { status: 'failed'; reason: string };
