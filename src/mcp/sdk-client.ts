import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpClientFactory, McpClientPort, MaterializedMcpTransportConfig } from './contracts.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export const createSdkMcpClient: McpClientFactory = async ({ server, transport }) => {
  const timeoutMs = server.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sdkTransport = createTransport(transport);
  const client = new Client({ name: 'super-helper', version: '0.1.0' });
  await client.connect(sdkTransport, { timeout: timeoutMs });

  const port: McpClientPort = {
    async listTools() {
      const result = await client.listTools({}, { timeout: timeoutMs });
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    callTool(name, argumentsValue) {
      return client.callTool({ name, arguments: argumentsValue }, undefined, { timeout: timeoutMs });
    },
    close() {
      return client.close();
    },
  };
  return port;
};

function createTransport(config: MaterializedMcpTransportConfig): Transport {
  if (config.protocol === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: { ...getDefaultEnvironment(), ...config.env },
      stderr: 'pipe',
    });
  }

  const requestInit: RequestInit = { headers: config.headers };
  if (config.protocol === 'http') {
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit });
  }

  const fetchWithHeaders: typeof fetch = (input, init) => fetch(input, {
    ...init,
    headers: { ...config.headers, ...headersRecord(init?.headers) },
  });
  return new SSEClientTransport(new URL(config.url), {
    requestInit,
    fetch: fetchWithHeaders,
  });
}

function headersRecord(headers?: HeadersInit): Record<string, string> {
  return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
}
