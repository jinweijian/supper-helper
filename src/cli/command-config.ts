import { configPath, ensureConfig, saveConfig } from '../config.js';
import type { McpServerConfig } from '../mcp/contracts.js';
import { readOption } from './args.js';

export function runInitCommand(): void {
  const path = configPath();
  const config = ensureConfig();
  saveConfig(config);
  console.log(`super helper config ready at ${path}`);
}

export function runConfigCommand(input: {
  command: string;
  argv: string[];
}): boolean {
  if (input.command === 'model' && input.argv[0] === 'set') {
    const name = input.argv[1] ?? 'default';
    const baseUrl = readOption(input.argv, '--base-url');
    const model = readOption(input.argv, '--model');
    const apiKey = readOption(input.argv, '--api-key');
    const apiKeyEnv = readOption(input.argv, '--api-key-env');
    if (!baseUrl || !model || (!apiKey && !apiKeyEnv)) {
      console.error('Usage: super-helper model set <name> --base-url <url> --model <model> (--api-key-env <env> | --api-key <key>)');
      process.exit(1);
    }

    const config = ensureConfig();
    config.models.providers[name] = {
      type: 'openai-compatible',
      baseUrl,
      model,
      apiKey,
      apiKeyEnv,
      temperature: 0,
    };
    config.agent.modelProvider = name;
    config.agent.useModelForPreflight = true;
    saveConfig(config);
    console.log(`agent model provider "${name}" configured`);
    return true;
  }

  if (input.command === 'workspace' && input.argv[0] === 'set') {
    const rootPath = readOption(input.argv, '--path');
    if (!rootPath) {
      console.error('Usage: super-helper workspace set --path <project-path> [--name <name>]');
      process.exit(1);
    }

    const config = ensureConfig();
    config.workspaces[0] = {
      id: 'current',
      name: readOption(input.argv, '--name') ?? 'Current Project',
      rootPath,
      mcpToolIds: config.workspaces[0]?.mcpToolIds ?? [],
    };
    saveConfig(config);
    console.log(`workspace configured: ${rootPath}`);
    return true;
  }

  if (input.command === 'mcp' && input.argv[0] === 'add') {
    const id = input.argv[1];
    const protocol = readOption(input.argv, '--protocol') as 'stdio' | 'http' | 'sse' | undefined;
    if (!id || !protocol || !['stdio', 'http', 'sse'].includes(protocol)) {
      console.error('Usage: super-helper mcp add <id> --protocol <stdio|http|sse> [--name <name>] [--permission read_only|read_write] [--config-json <json>]');
      process.exit(1);
    }

    const config = ensureConfig();
    const tool = {
      id,
      name: readOption(input.argv, '--name') ?? id,
      protocol,
      permission: (readOption(input.argv, '--permission') as 'read_only' | 'read_write' | undefined) ?? 'read_only',
      enabled: true,
      config: readJsonOption(input.argv, '--config-json'),
    } as McpServerConfig;
    config.mcpTools = config.mcpTools.filter((item) => item.id !== id).concat(tool);
    config.workspaces[0] = {
      ...config.workspaces[0],
      mcpToolIds: Array.from(new Set([...(config.workspaces[0]?.mcpToolIds ?? []), id])),
    };
    saveConfig(config);
    console.log(`MCP tool configured: ${id}`);
    return true;
  }

  return false;
}

function readJsonOption(argv: string[], name: string): unknown {
  const value = readOption(argv, name);
  if (!value) {
    return undefined;
  }
  return JSON.parse(value);
}
