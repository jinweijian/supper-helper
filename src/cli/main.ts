import {
  runDevServerCommand,
  runServerCommand,
} from './command-server.js';
import { runDoctorCommand } from './command-doctor.js';
import { runStatusCommand } from './command-status.js';
import { runAcceptCommand } from './command-accept.js';
import { runConfigCommand, runInitCommand } from './command-config.js';
import { runKnowledgeCommand } from './command-knowledge.js';
import { runProviderCommand } from './command-provider.js';
import { runRetrievalCommand } from './command-retrieval.js';

export async function main(): Promise<void> {
  const command = process.argv[2] ?? 'dashboard';
  const argv = process.argv.slice(3);

  if (command === 'onboard' || command === 'dashboard') {
    await runServerCommand({ mode: command, argv });
    return;
  }

  if (command === 'dev' || command === 'serve') {
    await runDevServerCommand({ argv });
    return;
  }

  if (command === 'status') {
    await runStatusCommand({ argv });
    return;
  }

  if (command === 'doctor') {
    const result = await runDoctorCommand({ argv });
    if (!result.ok) {
      process.exit(1);
    }
    return;
  }

  if (command === 'init') {
    runInitCommand();
    return;
  }

  if (command === 'knowledge') {
    await runKnowledgeCommand(argv);
    return;
  }

  if (command === 'embedding') {
    await runProviderCommand({ capability: 'embedding', argv });
    return;
  }

  if (command === 'rerank') {
    await runProviderCommand({ capability: 'rerank', argv });
    return;
  }

  if (command === 'retrieval') {
    await runRetrievalCommand(argv);
    return;
  }

  if (command === 'accept') {
    await runAcceptCommand(argv);
    return;
  }

  if (runConfigCommand({ command, argv })) {
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

function printUsage(): void {
  console.error('Usage: super-helper [dashboard|onboard|status|doctor|init|dev|knowledge <init|update|extract|normalize|slice|audit|repair|review|publish|migration-report|redmine import-fixture|vector build>|retrieval <search|debug|eval>|embedding test|rerank test|model set|workspace set|mcp add]');
}

export function runCli(): void {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
