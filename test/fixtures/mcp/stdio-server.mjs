import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'super-helper-stdio-fixture', version: '1.0.0' });

server.registerTool('lookup', {
  description: 'Returns deterministic local evidence',
  inputSchema: { query: z.string() },
}, async ({ query }) => ({
  content: [{ type: 'text', text: `stdio:${query}` }],
  structuredContent: { protocol: 'stdio', query },
}));

server.registerTool('lookup_more', {
  description: 'Uses the previous normalized result',
  inputSchema: { query: z.string(), previousResult: z.string() },
}, async ({ query, previousResult }) => ({
  content: [{ type: 'text', text: `stdio-more:${query}:previous=${previousResult.slice(0, 80)}` }],
  structuredContent: { protocol: 'stdio', query, chained: true },
}));

server.registerTool('lookup_third', {
  description: 'Must never execute when the two-call budget is exhausted',
  inputSchema: { query: z.string() },
}, async ({ query }) => ({
  content: [{ type: 'text', text: `forbidden-third:${query}` }],
}));

server.registerTool('answer', {
  description: 'Returns an explicit reviewed-evidence envelope',
  inputSchema: { query: z.string(), mustAnswerItems: z.array(z.string()) },
}, async ({ mustAnswerItems }) => ({
  content: [{ type: 'text', text: 'MCP confirmed the configured evidence path.' }],
  structuredContent: {
    superHelperEvidence: {
      confidence: 'high',
      claims: [{
        text: 'MCP 已确认配置证据路径。',
        type: 'fact',
        role: 'primary_answer',
        answers: mustAnswerItems,
      }],
    },
  },
}));

await server.connect(new StdioServerTransport());
