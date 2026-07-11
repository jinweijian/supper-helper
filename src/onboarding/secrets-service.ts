import type { ModelProviderConfig, SuperHelperConfig } from '../config.js';
import type { SecretRef } from '../domain.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import type { FileOnboardingDraftRepository } from './draft-repository.js';
import { FileSecretsRepository } from './secrets.js';
import type { OnboardingDraft, OnboardingDraftInput } from './types.js';

/** Owns every conversion across the public-draft / SecretRef boundary. */
export class OnboardingSecretsService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly secrets: FileSecretsRepository,
  ) {}

  loadEffectiveDraft(drafts: Pick<FileOnboardingDraftRepository, 'load'>): OnboardingDraft | undefined {
    return drafts.load() ?? this.draftFromConfig();
  }

  createDraft(input: OnboardingDraftInput, previous?: OnboardingDraft): OnboardingDraft {
    this.rejectUnsafeInput(input);
    const draft: OnboardingDraft = {
      ...structuredClone(input.draft),
      revision: 0,
      updatedAt: new Date().toISOString(),
      agent: {
        providerId: input.draft.agent.providerId,
        provider: structuredClone(input.draft.agent.provider),
      },
      embedding: structuredClone(input.draft.embedding),
      rerank: structuredClone(input.draft.rerank),
    };
    this.preserveExistingRefs(draft, previous, input.secrets);
    if (input.secrets?.agentApiKey) {
      draft.agent.provider.apiKeyRef = this.secrets.set(`providers.agent.${draft.agent.providerId}`, input.secrets.agentApiKey);
    }
    if (input.secrets?.embeddingApiKey) {
      draft.embedding.apiKeyRef = this.secrets.set('providers.embedding', input.secrets.embeddingApiKey);
    }
    if (input.secrets?.rerankApiKey) {
      draft.rerank.apiKeyRef = this.secrets.set('providers.rerank', input.secrets.rerankApiKey);
    }
    return draft;
  }

  sanitizeDraft(draft: OnboardingDraft): Record<string, unknown> {
    return {
      version: draft.version,
      revision: draft.revision,
      workspace: draft.workspace,
      knowledge: draft.knowledge,
      server: draft.server,
      agent: {
        providerId: draft.agent.providerId,
        provider: this.sanitizeProvider(draft.agent.provider),
      },
      embedding: this.sanitizeProvider(draft.embedding),
      rerank: this.sanitizeProvider(draft.rerank),
      updatedAt: draft.updatedAt,
    };
  }

  materializeDraft(draft: OnboardingDraft): OnboardingDraft {
    const copy = structuredClone(draft);
    copy.agent.provider.apiKey = this.secrets.resolve(copy.agent.provider.apiKeyRef) ?? copy.agent.provider.apiKey;
    copy.embedding.apiKey = this.secrets.resolve(copy.embedding.apiKeyRef) ?? copy.embedding.apiKey;
    copy.rerank.apiKey = this.secrets.resolve(copy.rerank.apiKeyRef) ?? copy.rerank.apiKey;
    return copy;
  }

  resolveSecret(ref: SecretRef | undefined): string | undefined {
    return this.secrets.resolve(ref);
  }

  knowledgeWorkspaceRoot(draft: OnboardingDraft): string {
    const config = structuredClone(this.config);
    config.knowledge = { ...config.knowledge, rootDir: draft.knowledge.rootDir };
    config.workspaces = [{
      id: draft.workspace.id,
      name: draft.workspace.name,
      rootPath: draft.workspace.rootPath,
      mcpToolIds: config.workspaces.find((workspace) => workspace.id === draft.workspace.id)?.mcpToolIds ?? [],
    }];
    return resolveKnowledgeWorkspaceRoot(config, draft.workspace.id);
  }

  private rejectUnsafeInput(input: OnboardingDraftInput): void {
    const provider = input.draft.agent.provider as Record<string, unknown>;
    const embedding = input.draft.embedding as Record<string, unknown>;
    const rerank = input.draft.rerank as Record<string, unknown>;
    if (provider.apiKey || provider.apiKeyEnv || embedding.apiKey || embedding.apiKeyEnv || rerank.apiKey || rerank.apiKeyEnv) {
      throw new Error('Onboarding draft input cannot include plaintext secrets or apiKeyEnv; use secrets or env apiKeyRef.');
    }
    for (const [field, ref] of [
      ['agent.provider.apiKeyRef', input.draft.agent.provider.apiKeyRef],
      ['embedding.apiKeyRef', input.draft.embedding.apiKeyRef],
      ['rerank.apiKeyRef', input.draft.rerank.apiKeyRef],
    ] as const) {
      if (ref && ref.source !== 'env') throw new Error(`${field} must be an env SecretRef in public input.`);
    }
  }

  private sanitizeProvider<T extends { apiKeyRef?: SecretRef }>(provider: T) {
    const { apiKey: _apiKey, apiKeyEnv: _apiKeyEnv, apiKeyRef, ...rest } = provider as T & {
      apiKey?: string;
      apiKeyEnv?: string;
    };
    return {
      ...rest,
      apiKeyRef: apiKeyRef ? (apiKeyRef.source === 'env' ? { source: 'env', name: apiKeyRef.name } : { source: 'file' }) : undefined,
      hasApiKey: this.secrets.has(apiKeyRef),
    };
  }

  private draftFromConfig(): OnboardingDraft {
    const workspace = this.config.workspaces[0] ?? {
      id: 'current', name: 'Current Project', rootPath: process.cwd(), mcpToolIds: [],
    };
    const providerId = this.activeProviderId();
    return {
      version: 1,
      revision: 0,
      workspace: { id: workspace.id, name: workspace.name, rootPath: workspace.rootPath },
      knowledge: {
        rootDir: this.config.knowledge.rootDir,
        sourceDir: this.config.knowledge.sourceDir,
        buildVectorIndex: this.config.knowledge.buildVectorIndex,
        chunking: this.config.knowledge.chunking,
      },
      server: {
        bindMode: this.config.server.bindMode,
        host: this.config.server.host,
        port: this.config.server.port,
      },
      agent: {
        providerId,
        provider: this.providerForDraft(this.config.models.providers[providerId] ?? this.defaultAgentProvider()),
      },
      embedding: this.providerForDraft(this.config.embedding),
      rerank: this.providerForDraft(this.config.rerank),
      updatedAt: this.config.onboarding.completedAt ?? new Date(0).toISOString(),
    };
  }

  private activeProviderId(): string {
    if (this.config.agent.modelProvider && this.config.models.providers[this.config.agent.modelProvider]) {
      return this.config.agent.modelProvider;
    }
    return Object.keys(this.config.models.providers)[0] ?? 'default';
  }

  private defaultAgentProvider(): ModelProviderConfig {
    return { type: 'openai-compatible', baseUrl: 'https://api.minimaxi.com/v1', model: '' };
  }

  private providerForDraft<T extends { apiKey?: string; apiKeyEnv?: string; apiKeyRef?: SecretRef }>(provider: T): T {
    const copy = structuredClone(provider);
    if (!copy.apiKeyRef && copy.apiKeyEnv) copy.apiKeyRef = { source: 'env', name: copy.apiKeyEnv };
    delete copy.apiKey;
    delete copy.apiKeyEnv;
    return copy;
  }

  private preserveExistingRefs(
    draft: OnboardingDraft,
    previous: OnboardingDraft | undefined,
    secrets: OnboardingDraftInput['secrets'] | undefined,
  ): void {
    if (!secrets?.agentApiKey && !draft.agent.provider.apiKeyRef
      && previous?.agent.providerId === draft.agent.providerId && previous.agent.provider.apiKeyRef) {
      draft.agent.provider.apiKeyRef = previous.agent.provider.apiKeyRef;
    }
    this.preserveProviderRef(draft.embedding, previous?.embedding, Boolean(secrets?.embeddingApiKey));
    this.preserveProviderRef(draft.rerank, previous?.rerank, Boolean(secrets?.rerankApiKey));
  }

  private preserveProviderRef<T extends { provider: string; apiKeyRef?: SecretRef }>(
    provider: T,
    previous: T | undefined,
    hasNewSecret: boolean,
  ): void {
    if (!hasNewSecret && !provider.apiKeyRef && previous?.apiKeyRef && provider.provider === previous.provider) {
      provider.apiKeyRef = previous.apiKeyRef;
    }
  }
}
