import type { SuperHelperConfig } from '../config.js';
import { DiagnosticRuntime } from '../runtime/diagnostic-runtime.js';
import { resolveSessionStorageRoot } from '../sessions/storage-scope.js';
import { FileMemoryStore } from '../sessions/file-memory-store.js';
import type { DiagnosticWorkerFactory } from '../workers/default-worker-factory.js';
import type { SecretRef } from '../domain.js';

export class GatewayApplicationContext {
  config: SuperHelperConfig;
  store: FileMemoryStore;
  agent: DiagnosticRuntime;

  constructor(
    config: SuperHelperConfig,
    private readonly createWorker: DiagnosticWorkerFactory,
    private readonly resolveSecret?: (ref: SecretRef) => string | undefined,
  ) {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new DiagnosticRuntime(config, this.store, this.createWorker(config), {
      mcp: { resolveSecret: this.resolveSecret },
    });
  }

  reload(config: SuperHelperConfig): void {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new DiagnosticRuntime(config, this.store, this.createWorker(config), {
      mcp: { resolveSecret: this.resolveSecret },
    });
  }
}
