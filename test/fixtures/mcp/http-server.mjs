import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

const mode = process.argv[2];
if (mode !== 'http' && mode !== 'sse') throw new Error('expected http or sse mode');

function fixtureServer() {
  const server = new McpServer({ name: `super-helper-${mode}-fixture`, version: '1.0.0' });
  server.registerTool('lookup', {
    description: 'Returns deterministic local evidence',
    inputSchema: { query: z.string() },
  }, async ({ query }) => ({
    content: [{ type: 'text', text: `${mode}:${query}` }],
    structuredContent: { protocol: mode, query },
  }));
  return server;
}

const app = createMcpExpressApp();
const transports = new Map();

if (mode === 'http') {
  app.post('/mcp', async (req, res) => {
    const server = fixtureServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  });
} else {
  app.get('/sse', async (_req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    transport.onclose = () => transports.delete(transport.sessionId);
    await fixtureServer().connect(transport);
  });
  app.post('/messages', async (req, res) => {
    const sessionId = String(req.query.sessionId ?? '');
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).end('session not found');
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });
}

const listener = app.listen(0, '127.0.0.1', () => {
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('fixture address unavailable');
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});

async function shutdown() {
  for (const transport of transports.values()) await transport.close().catch(() => undefined);
  listener.close(() => process.exit(0));
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
