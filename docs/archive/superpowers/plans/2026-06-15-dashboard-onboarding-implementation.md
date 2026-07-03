# Dashboard 一键 Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 OpenClaw 风格的 `onboard/dashboard/doctor/status` 命令，让用户在 Dashboard 中一次完成 workspace、知识库、Agent、Embedding、Rerank 配置，并获得可恢复的真实任务进度。

**Architecture:** 新增 `src/onboarding/` 作为独立应用模块，持久化配置草稿和单个后台 run，通过现有 `src/knowledge/`、`src/embedding/` 和模型客户端执行各阶段。Gateway 只暴露 DTO、SSE 和页面路由；CLI 只负责命令解析、网络绑定、启动服务和打开浏览器。正式配置只在 run 成功后原子提交，API Key 通过 SecretRef 存入独立 secrets 文件。

**Tech Stack:** TypeScript 5、Node.js 20+ 原生 HTTP/SSE、文件系统 JSON 持久化、现有无框架 HTML UI、Node test runner、pnpm。

---

## 文件结构

新增文件：

```text
src/onboarding/
  types.ts                 # 草稿、run、阶段、事件、状态 DTO
  paths.ts                 # onboarding 文件路径
  atomic-json.ts           # 原子 JSON 写入
  secrets.ts               # SecretRef 文件仓库、迁移、脱敏
  draft-repository.ts      # draft.json 读写
  run-repository.ts        # run JSON 读写与中断恢复
  validator.ts             # 草稿和路径校验
  planner.ts               # 增量执行计划
  provider-tests.ts        # Agent/Embedding/Rerank 连通性测试
  knowledge-pipeline.ts    # 分阶段知识处理 adapter
  progress.ts              # 阶段权重、真实进度、事件 hub
  runner.ts                # 后台执行器
  config-commit.ts         # 正式配置原子提交
  service.ts               # CLI/Gateway 公共应用服务
  index.ts                 # 公共导出
src/cli/
  index.ts                 # CLI helper 公共导出（供测试）
  args.ts                  # 命令参数解析
  bindings.ts              # loopback/lan/host 地址解析
  open-browser.ts          # 跨平台打开浏览器
  server-commands.ts       # onboard/dashboard
  status-command.ts        # status
  doctor-command.ts        # doctor
src/gateway/routes/onboarding-routes.ts
src/gateway/application-context.ts
src/setup-ui.ts
src/model-smoke-test.ts
test/onboarding.test.mjs
test/onboarding-http.test.mjs
test/onboarding-cli.test.mjs
test/helpers/onboarding-fixtures.mjs
test/helpers/full-onboarding-fixture.mjs
```

修改文件：

```text
src/domain.ts
src/config.ts
src/model.ts
src/embedding/types.ts
src/embedding/siliconflow.ts
src/embedding/rerank-smoke-test.ts
src/knowledge/ingest.ts
src/knowledge/publish.ts
src/knowledge/vector-index.ts
src/knowledge/index.ts
src/gateway/http-utils.ts
src/gateway/http-server.ts
src/gateway/application-context.ts
src/gateway/routes/settings-routes.ts
src/gateway/dto.ts
src/ui.ts
src/cli.ts
package.json
README.md
docs/standards/development.md
docs/architecture/overview.md
test/knowledge.test.mjs
test/embedding.test.mjs
test/supper-helper.test.mjs
```

## Task 1: 建立 SecretRef 和原子配置持久化

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/config.ts`
- Create: `src/onboarding/atomic-json.ts`
- Create: `src/onboarding/secrets.ts`
- Test: `test/onboarding.test.mjs`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写 SecretRef 和原子写入失败测试**

在 `test/onboarding.test.mjs` 新增：

```js
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig, saveConfig } from '../dist/config.js';
import {
  FileSecretsRepository,
  materializeConfigSecrets,
  migrateLegacyConfigSecrets,
} from '../dist/onboarding/index.js';

test('secret repository stores file secrets outside config and materializes runtime config', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const secrets = new FileSecretsRepository(root);
    const ref = secrets.set('providers.agent.default', 'sk-agent-secret');
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKeyRef: ref,
    };
    config.agent.modelProvider = 'default';

    saveConfig(config, join(root, 'config.json'));
    const persisted = readFileSync(join(root, 'config.json'), 'utf8');
    assert.doesNotMatch(persisted, /sk-agent-secret/);
    assert.match(persisted, /providers\.agent\.default/);
    assert.equal(statSync(join(root, 'secrets.json')).mode & 0o777, 0o600);

    const runtime = materializeConfigSecrets(loadConfig(join(root, 'config.json')), secrets);
    assert.equal(runtime.models.providers.default.apiKey, 'sk-agent-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy inline keys migrate to file SecretRefs without leaking plaintext', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKey: 'legacy-secret',
    };
    config.agent.modelProvider = 'default';
    const secrets = new FileSecretsRepository(root);

    const migrated = migrateLegacyConfigSecrets(config, secrets);
    saveConfig(migrated, join(root, 'config.json'));

    assert.equal(migrated.models.providers.default.apiKey, undefined);
    assert.equal(migrated.models.providers.default.apiKeyRef.key, 'providers.agent.default');
    assert.doesNotMatch(readFileSync(join(root, 'config.json'), 'utf8'), /legacy-secret/);
    assert.equal(secrets.resolve(migrated.models.providers.default.apiKeyRef), 'legacy-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

在 `test/supper-helper.test.mjs` 的 config 测试附近补充：

```js
test('saveConfig replaces config atomically and leaves no temp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  const target = join(dir, 'config.json');
  try {
    const config = baseConfig(dir);
    saveConfig(config, target);
    const first = readFileSync(target, 'utf8');
    config.server.port = 4555;
    saveConfig(config, target);
    const second = readFileSync(target, 'utf8');
    assert.notEqual(first, second);
    assert.equal(JSON.parse(second).server.port, 4555);
    assert.equal(existsSync(`${target}.tmp`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 构建并确认测试失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="secret repository|legacy inline" test/onboarding.test.mjs
```

Expected: FAIL，提示 `../dist/onboarding/index.js` 不存在或 `apiKeyRef` 类型不存在。

- [ ] **Step 3: 定义 SecretRef、配置字段和原子写入**

在 `src/domain.ts` 增加：

```ts
export type SecretRef =
  | { source: 'file'; key: string }
  | { source: 'env'; name: string };
```

在 `src/config.ts`：

```ts
import { renameSync } from 'node:fs';
import type { SecretRef } from './domain.js';

export interface ModelProviderConfig {
  // 保留现有字段用于内存运行和兼容迁移。
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyRef?: SecretRef;
  // 其余现有字段保持不变。
}
```

扩展配置：

```ts
server: {
  host: string;
  port: number;
  bindMode: 'loopback' | 'lan';
};
knowledge: {
  rootDir: string;
  isolateByWorkspace: boolean;
  sourceDir?: string;
  buildVectorIndex: boolean;
};
onboarding: {
  version: 1;
  completedAt?: string;
  lastRunId?: string;
};
```

默认值：

```ts
server: { host: '127.0.0.1', port: 4317, bindMode: 'loopback' },
knowledge: {
  rootDir: join(DEFAULT_HOME, 'knowledge'),
  isolateByWorkspace: true,
  buildVectorIndex: false,
},
onboarding: { version: 1 },
```

新增 `src/onboarding/atomic-json.ts`：

```ts
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  renameSync(temp, path);
}
```

让 `saveConfig()` 使用 `writeJsonAtomic()`，并在序列化前删除 provider 中的临时 `apiKey`：

```ts
export function configForPersistence(config: SuperHelperConfig): SuperHelperConfig {
  const copy = structuredClone(config);
  for (const provider of Object.values(copy.models.providers)) {
    if (provider.apiKeyRef) delete provider.apiKey;
  }
  if (copy.embedding.apiKeyRef) delete copy.embedding.apiKey;
  if (copy.rerank.apiKeyRef) delete copy.rerank.apiKey;
  return copy;
}

export function saveConfig(config: SuperHelperConfig, path = configPath(config.storage.rootDir)): void {
  writeJsonAtomic(path, configForPersistence(config));
}
```

- [ ] **Step 4: 实现 secrets 仓库和兼容迁移**

新增 `src/onboarding/secrets.ts`：

```ts
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SuperHelperConfig } from '../config.js';
import type { SecretRef } from '../domain.js';
import { writeJsonAtomic } from './atomic-json.js';

type SecretFile = { version: 1; values: Record<string, string> };

export class FileSecretsRepository {
  readonly path: string;

  constructor(rootDir: string) {
    this.path = join(rootDir, 'secrets.json');
  }

  set(key: string, value: string): SecretRef {
    const file = this.read();
    file.values[key] = value;
    writeJsonAtomic(this.path, file, 0o600);
    chmodSync(this.path, 0o600);
    return { source: 'file', key };
  }

  resolve(ref?: SecretRef): string | undefined {
    if (!ref) return undefined;
    if (ref.source === 'env') return process.env[ref.name];
    return this.read().values[ref.key];
  }

  has(ref?: SecretRef): boolean {
    return Boolean(this.resolve(ref));
  }

  private read(): SecretFile {
    if (!existsSync(this.path)) return { version: 1, values: {} };
    return JSON.parse(readFileSync(this.path, 'utf8')) as SecretFile;
  }
}

export function materializeConfigSecrets(
  config: SuperHelperConfig,
  secrets: FileSecretsRepository,
): SuperHelperConfig {
  const copy = structuredClone(config);
  for (const provider of Object.values(copy.models.providers)) {
    provider.apiKey = secrets.resolve(provider.apiKeyRef) ?? provider.apiKey;
  }
  copy.embedding.apiKey = secrets.resolve(copy.embedding.apiKeyRef) ?? copy.embedding.apiKey;
  copy.rerank.apiKey = secrets.resolve(copy.rerank.apiKeyRef) ?? copy.rerank.apiKey;
  return copy;
}

export function migrateLegacyConfigSecrets(
  config: SuperHelperConfig,
  secrets: FileSecretsRepository,
): SuperHelperConfig {
  const copy = structuredClone(config);
  for (const [id, provider] of Object.entries(copy.models.providers)) {
    if (provider.apiKey && !provider.apiKeyRef) {
      provider.apiKeyRef = secrets.set(`providers.agent.${id}`, provider.apiKey);
      delete provider.apiKey;
    } else if (provider.apiKeyEnv && !provider.apiKeyRef) {
      provider.apiKeyRef = { source: 'env', name: provider.apiKeyEnv };
    }
  }
  for (const [key, provider] of [['embedding', copy.embedding], ['rerank', copy.rerank]] as const) {
    if (provider.apiKey && !provider.apiKeyRef) {
      provider.apiKeyRef = secrets.set(`providers.${key}`, provider.apiKey);
      delete provider.apiKey;
    } else if (provider.apiKeyEnv && !provider.apiKeyRef) {
      provider.apiKeyRef = { source: 'env', name: provider.apiKeyEnv };
    }
  }
  return copy;
}
```

同时在 `src/embedding/types.ts`：

```ts
import type { SecretRef } from '../domain.js';
```

并给 `EmbeddingProviderConfig`、`RerankProviderConfig` 增加 `apiKeyRef?: SecretRef`。

- [ ] **Step 5: 运行聚焦测试**

Run:

```bash
pnpm build && node --test --test-name-pattern="secret repository|legacy inline" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/domain.ts src/config.ts src/embedding/types.ts src/onboarding/atomic-json.ts src/onboarding/secrets.ts test/onboarding.test.mjs test/supper-helper.test.mjs
git commit -m "feat: add onboarding secret references"
```

## Task 2: 建立草稿、Run 类型与文件仓库

**Files:**
- Create: `src/onboarding/types.ts`
- Create: `src/onboarding/paths.ts`
- Create: `src/onboarding/draft-repository.ts`
- Create: `src/onboarding/run-repository.ts`
- Create: `src/onboarding/index.ts`
- Test: `test/onboarding.test.mjs`
- Create: `test/helpers/onboarding-fixtures.mjs`

- [ ] **Step 1: 写 repository 行为测试**

追加：

```js
import {
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
} from '../dist/onboarding/index.js';

test('draft repository increments revision and never persists plaintext secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingDraftRepository(root);
    const saved = repository.save({
      version: 1,
      revision: 0,
      workspace: { id: 'current', name: 'Demo', rootPath: '/tmp/demo' },
      knowledge: { rootDir: '/tmp/kb', sourceDir: '/tmp/sources', buildVectorIndex: true },
      server: { bindMode: 'loopback', port: 4317 },
      agent: { providerId: 'default', provider: { type: 'openai-compatible', baseUrl: 'https://api.test/v1', model: 'm' } },
      embedding: { enabled: false, provider: 'siliconflow', model: 'e', dimensions: 4, distance: 'cosine' },
      rerank: { enabled: false, provider: 'siliconflow', model: 'r' },
      updatedAt: new Date().toISOString(),
    });
    assert.equal(saved.revision, 1);
    assert.equal(repository.load().workspace.name, 'Demo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run repository recovers interrupted runs as retryable failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const repository = new FileOnboardingRunRepository(root);
    repository.save({
      id: 'run_test',
      status: 'running',
      draftRevision: 1,
      currentStage: 'slice_sources',
      overallProgress: 45,
      stages: [],
      counters: {},
      startedAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    });
    const recovered = repository.recoverInterrupted();
    assert.equal(recovered[0].status, 'failed');
    assert.equal(recovered[0].retryableStage, 'slice_sources');
    assert.equal(recovered[0].safeError.code, 'interrupted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="draft repository|run repository" test/onboarding.test.mjs
```

Expected: FAIL，仓库类尚不存在。

- [ ] **Step 3: 定义核心类型**

`src/onboarding/types.ts`：

```ts
import type { ModelProviderConfig } from '../config.js';
import type { EmbeddingProviderConfig, RerankProviderConfig } from '../embedding/index.js';

export type OnboardingStageId =
  | 'validate_draft'
  | 'test_providers'
  | 'prepare_workspace'
  | 'ingest_sources'
  | 'extract_sources'
  | 'normalize_sources'
  | 'slice_sources'
  | 'audit_slices'
  | 'publish_approved'
  | 'build_keyword_index'
  | 'build_vector_index'
  | 'health_check'
  | 'commit_config';

export type OnboardingStatus = 'pending' | 'running' | 'failed' | 'completed';
export type OnboardingStageStatus = 'pending' | 'running' | 'failed' | 'completed' | 'skipped';

export interface OnboardingDraft {
  version: 1;
  revision: number;
  workspace: { id: string; name: string; rootPath: string };
  knowledge: { rootDir: string; sourceDir?: string; buildVectorIndex: boolean };
  server: { bindMode: 'loopback' | 'lan'; host?: string; port: number };
  agent: { providerId: string; provider: ModelProviderConfig };
  embedding: EmbeddingProviderConfig;
  rerank: RerankProviderConfig;
  updatedAt: string;
}

export interface OnboardingStageState {
  id: OnboardingStageId;
  status: OnboardingStageStatus;
  progress: number;
  processed?: number;
  total?: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  safeError?: OnboardingSafeError;
}

export interface OnboardingSafeError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface OnboardingRun {
  id: string;
  status: OnboardingStatus;
  draftRevision: number;
  currentStage?: OnboardingStageId;
  overallProgress: number;
  stages: OnboardingStageState[];
  counters: Record<string, number>;
  safeError?: OnboardingSafeError;
  retryableStage?: OnboardingStageId;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  healthSummary?: Record<string, unknown>;
}

export interface OnboardingProgressEvent {
  type:
    | 'run.started'
    | 'stage.started'
    | 'stage.progress'
    | 'stage.completed'
    | 'stage.skipped'
    | 'stage.failed'
    | 'run.completed'
    | 'run.failed';
  runId: string;
  at: string;
  run: OnboardingRun;
}
```

- [ ] **Step 4: 实现路径和仓库**

`src/onboarding/paths.ts`：

```ts
import { join } from 'node:path';

export const onboardingRoot = (rootDir: string): string => join(rootDir, 'onboarding');
export const onboardingDraftPath = (rootDir: string): string => join(onboardingRoot(rootDir), 'draft.json');
export const onboardingRunsRoot = (rootDir: string): string => join(onboardingRoot(rootDir), 'runs');
export const onboardingRunPath = (rootDir: string, runId: string): string =>
  join(onboardingRunsRoot(rootDir), `${runId}.json`);
```

仓库使用 `writeJsonAtomic()`，`FileOnboardingRunRepository` 实现：

```ts
save(run: OnboardingRun): OnboardingRun;
load(id: string): OnboardingRun | undefined;
latest(): OnboardingRun | undefined;
list(): OnboardingRun[];
findActive(): OnboardingRun | undefined;
recoverInterrupted(): OnboardingRun[];
```

`recoverInterrupted()` 将所有 `running` run 转成：

```ts
{
  ...run,
  status: 'failed',
  retryableStage: run.currentStage,
  safeError: {
    code: 'interrupted',
    message: 'Onboarding was interrupted while the service was not running.',
    retryable: true,
  },
}
```

- [ ] **Step 5: 导出并运行测试**

在 `src/onboarding/index.ts` 导出 Task 1 和 Task 2 的公共符号。

新增 `test/helpers/onboarding-fixtures.mjs`，供后续任务复用：

```js
import process from 'node:process';

export function embeddingFixture(overrides = {}) {
  return {
    enabled: false,
    provider: 'fake',
    model: 'fake-embedding',
    dimensions: 4,
    distance: 'cosine',
    batchSize: 2,
    timeoutMs: 1000,
    ...overrides,
  };
}

export function rerankFixture(overrides = {}) {
  return {
    enabled: false,
    provider: 'siliconflow',
    model: 'fake-rerank',
    topN: 2,
    timeoutMs: 1000,
    ...overrides,
  };
}

export function onboardingDraftFixture(overrides = {}) {
  const base = {
    version: 1,
    revision: 1,
    workspace: { id: 'current', name: 'Demo', rootPath: process.cwd() },
    knowledge: { rootDir: `${process.cwd()}/.tmp-knowledge`, buildVectorIndex: false },
    server: { bindMode: 'loopback', port: 4317 },
    agent: {
      providerId: 'default',
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        model: 'fake-agent',
        apiKeyRef: { source: 'file', key: 'providers.agent.default' },
      },
    },
    embedding: embeddingFixture(),
    rerank: rerankFixture(),
    updatedAt: '2026-06-15T00:00:00.000Z',
  };
  return {
    ...base,
    ...overrides,
    workspace: { ...base.workspace, ...(overrides.workspace ?? {}) },
    knowledge: { ...base.knowledge, ...(overrides.knowledge ?? {}) },
    server: { ...base.server, ...(overrides.server ?? {}) },
    agent: {
      ...base.agent,
      ...(overrides.agent ?? {}),
      provider: { ...base.agent.provider, ...(overrides.agent?.provider ?? {}) },
    },
    embedding: { ...base.embedding, ...(overrides.embedding ?? {}) },
    rerank: { ...base.rerank, ...(overrides.rerank ?? {}) },
  };
}

export function draftInputFixture(overrides = {}) {
  const draft = onboardingDraftFixture(overrides);
  const { revision: _revision, updatedAt: _updatedAt, ...inputDraft } = draft;
  const {
    apiKey: _apiKey,
    apiKeyEnv: _apiKeyEnv,
    apiKeyRef: _apiKeyRef,
    ...agentProvider
  } = inputDraft.agent.provider;
  inputDraft.agent.provider = agentProvider;
  delete inputDraft.embedding.apiKey;
  delete inputDraft.embedding.apiKeyRef;
  delete inputDraft.rerank.apiKey;
  delete inputDraft.rerank.apiKeyRef;
  return { draft: inputDraft };
}
```

Run:

```bash
pnpm build && node --test --test-name-pattern="draft repository|run repository" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/onboarding test/onboarding.test.mjs test/helpers/onboarding-fixtures.mjs
git commit -m "feat: persist onboarding drafts and runs"
```

## Task 3: 草稿校验与增量执行计划

**Files:**
- Create: `src/onboarding/validator.ts`
- Create: `src/onboarding/planner.ts`
- Modify: `src/onboarding/types.ts`
- Test: `test/onboarding.test.mjs`

- [ ] **Step 1: 写校验和 planner 测试**

```js
import { buildOnboardingPlan, validateOnboardingDraft } from '../dist/onboarding/index.js';
import {
  embeddingFixture,
  onboardingDraftFixture,
} from './helpers/onboarding-fixtures.mjs';

test('validator reports missing workspace and enabled provider credentials', () => {
  const draft = onboardingDraftFixture({
    workspace: { id: 'current', name: 'Demo', rootPath: '/does/not/exist' },
    embedding: { ...embeddingFixture(), enabled: true, apiKeyRef: undefined },
  });
  const result = validateOnboardingDraft(draft, { resolveSecret: () => undefined });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === 'workspace.rootPath'));
  assert.ok(result.issues.some((issue) => issue.field === 'embedding.apiKeyRef'));
});

test('planner skips unchanged sources and compatible vector artifacts', () => {
  const plan = buildOnboardingPlan({
    draft: onboardingDraftFixture(),
    sourceChanges: { added: [], changed: [], unchanged: ['a.md'] },
    keywordIndexDirty: false,
    vectorCompatibility: 'compatible',
  });
  assert.equal(plan.stage('ingest_sources').action, 'skip');
  assert.equal(plan.stage('build_keyword_index').action, 'skip');
  assert.equal(plan.stage('build_vector_index').action, 'skip');
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="validator|planner" test/onboarding.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 实现 validator**

定义：

```ts
export interface OnboardingValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface OnboardingValidationResult {
  ok: boolean;
  issues: OnboardingValidationIssue[];
}
```

`validateOnboardingDraft()` 必须检查：

- workspace 绝对路径存在且是目录。
- knowledge root、sourceDir（如果有）可解析。
- port 为 1-65535。
- `bindMode` 合法。
- Agent `baseUrl/model/providerId` 非空。
- Agent 必须可以通过 SecretRef 解析密钥；启用的 Embedding、Rerank 同样检查，但仓库内置 `fake` provider 明确免密，用于测试和离线开发。
- Embedding dimensions、batchSize、timeout 为正数。
- Rerank topN、timeout 为正数。

校验函数只读，不创建目录。

- [ ] **Step 4: 实现 planner**

在 types 增加：

```ts
export interface OnboardingPlanStage {
  id: OnboardingStageId;
  action: 'run' | 'skip';
  reason: string;
  total?: number;
}

export interface OnboardingPlan {
  stages: OnboardingPlanStage[];
  stage(id: OnboardingStageId): OnboardingPlanStage;
}
```

Planner 输入源文件差异、索引 dirty 状态和向量兼容状态，按设计中的 13 个阶段生成计划。`test_providers`、`validate_draft`、`health_check`、`commit_config` 永远执行；没有 sourceDir 时知识源处理阶段跳过，但 `prepare_workspace` 和关键词索引健康检查仍执行。

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm build && node --test --test-name-pattern="validator|planner" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/onboarding/validator.ts src/onboarding/planner.ts src/onboarding/types.ts src/onboarding/index.ts test/onboarding.test.mjs
git commit -m "feat: validate and plan onboarding runs"
```

## Task 4: 抽取统一 Provider 连通性测试

**Files:**
- Create: `src/model-smoke-test.ts`
- Create: `src/onboarding/provider-tests.ts`
- Modify: `src/gateway/routes/settings-routes.ts`
- Modify: `src/model.ts`
- Test: `test/onboarding.test.mjs`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写三 Provider 并行测试**

```js
import { testOnboardingProviders } from '../dist/onboarding/index.js';
import { onboardingDraftFixture } from './helpers/onboarding-fixtures.mjs';

test('provider test runner reports agent embedding and rerank independently', async () => {
  const calls = [];
  const result = await testOnboardingProviders(onboardingDraftFixture({
    embedding: { enabled: true },
    rerank: { enabled: true },
  }), {
    testAgent: async () => (calls.push('agent'), { ok: true, model: 'agent', durationMs: 1 }),
    testEmbedding: async () => (calls.push('embedding'), { ok: true, model: 'embed', durationMs: 1, dimensions: 4, provider: 'fake' }),
    testRerank: async () => (calls.push('rerank'), { ok: true, model: 'rerank', durationMs: 1, provider: 'fake' }),
  });
  assert.deepEqual(new Set(calls), new Set(['agent', 'embedding', 'rerank']));
  assert.equal(result.ok, true);
  assert.equal(result.agent.ok, true);
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="provider test runner" test/onboarding.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 抽取 Agent smoke test**

`src/model-smoke-test.ts`：

```ts
import type { ModelProviderConfig } from './config.js';
import { createModelClient } from './model.js';

export interface ModelSmokeTestResult {
  ok: boolean;
  model: string;
  durationMs: number;
  reply?: string;
  error?: string;
}

export async function runModelSmokeTest(config: ModelProviderConfig): Promise<ModelSmokeTestResult> {
  const startedAt = Date.now();
  try {
    const reply = await createModelClient(config).complete([
      { role: 'system', content: 'You are a connectivity test for super helper. Reply briefly.' },
      { role: 'user', content: 'super helper model connectivity test. Reply with "ok".' },
    ]);
    return { ok: true, model: config.model, durationMs: Date.now() - startedAt, reply };
  } catch (error) {
    return {
      ok: false,
      model: config.model,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

修改 settings route 复用该函数，不再在 route 中拼测试消息。

- [ ] **Step 4: 实现 onboarding provider runner**

`testOnboardingProviders()` 使用 `Promise.all()`，禁用 Embedding/Rerank 时返回：

```ts
{ ok: true, skipped: true, reason: 'disabled' }
```

总结果只有启用的 provider 都通过时 `ok: true`。返回值必须经过安全错误格式化，不带 key、header 或 provider 原始 payload。

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm build && node --test --test-name-pattern="provider test runner" test/onboarding.test.mjs && node --test --test-name-pattern="settings API sanitizes" test/supper-helper.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/model-smoke-test.ts src/onboarding/provider-tests.ts src/gateway/routes/settings-routes.ts test/onboarding.test.mjs test/supper-helper.test.mjs
git commit -m "refactor: share provider smoke tests"
```

## Task 5: 将知识导入拆成可观测阶段

**Files:**
- Modify: `src/knowledge/ingest.ts`
- Modify: `src/knowledge/index.ts`
- Create: `src/onboarding/knowledge-pipeline.ts`
- Modify: `test/knowledge.test.mjs`
- Test: `test/onboarding.test.mjs`

- [ ] **Step 1: 写 intake 兼容和增量测试**

在 `test/knowledge.test.mjs`：

```js
import { discoverSourceFiles, intakeSourceDocument } from '../dist/knowledge/index.js';

test('knowledge intake exposes per-file stages and reuses unchanged content', () => {
  const workspace = tempWorkspace();
  const sourceDir = tempWorkspace();
  try {
    const path = join(sourceDir, 'guide.md');
    writeFileSync(path, '# Guide\n\nA meaningful answer-bearing paragraph.', 'utf8');
    const [source] = discoverSourceFiles(sourceDir);
    const first = intakeSourceDocument({ workspaceRoot: workspace, sourcePath: source });
    const second = intakeSourceDocument({ workspaceRoot: workspace, sourcePath: source });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(first.sourceDocumentId, second.sourceDocumentId);
  } finally {
    cleanup(workspace);
    cleanup(sourceDir);
  }
});
```

在 onboarding 测试加入阶段计数：

```js
test('knowledge pipeline reports real file and slice counts', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-pipeline-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'super-helper-sources-'));
  try {
    writeFileSync(join(sourceDir, 'a.md'), '# A\n\nA complete answer-bearing paragraph for source A.', 'utf8');
    writeFileSync(join(sourceDir, 'b.md'), '# B\n\nA complete answer-bearing paragraph for source B.', 'utf8');
    const events = [];
    const result = await runOnboardingKnowledgePipeline({
      draft: onboardingDraftFixture({
        knowledge: { rootDir: workspaceRoot, sourceDir, buildVectorIndex: false },
      }),
      workspaceRoot,
      report: (event) => events.push(event),
    });
    assert.ok(events.some((event) =>
      event.stage === 'ingest_sources' && event.processed === 2 && event.total === 2));
    assert.ok(result.draftSlices >= 2);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="knowledge intake exposes" test/knowledge.test.mjs && node --test --test-name-pattern="knowledge pipeline reports" test/onboarding.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 拆分 ingest 公共 API**

从现有私有逻辑提取并导出：

```ts
export function discoverSourceFiles(sourceDir?: string): string[];

export interface IntakeSourceDocumentResult {
  sourceDocumentId: string;
  sourceTitle: string;
  sourceKind: string;
  sourceMetaPath: string;
  sourceDocumentRelativePath: string;
  sourcePath: string;
  reused: boolean;
}

export function intakeSourceDocument(input: {
  workspaceRoot: string;
  sourcePath: string;
  force?: boolean;
}): IntakeSourceDocumentResult;
```

保留 `ingestSourceDocuments()` 的现有输出和行为，让旧 CLI 和测试继续通过；其内部改为依次调用：

```text
discoverSourceFiles
→ intakeSourceDocument
→ extractSourceBlocks
→ normalizeSourceBlocks
→ buildDraftSlices
```

- [ ] **Step 4: 实现 onboarding knowledge adapter**

`src/onboarding/knowledge-pipeline.ts` 逐文件执行阶段，并通过 callback 上报：

```ts
export interface KnowledgeStageProgress {
  stage: OnboardingStageId;
  processed: number;
  total: number;
  message: string;
}
```

每个 source 保存 `sourceDocumentId`，后续 extract、normalize、slice 使用现有 API。未变化文件在 intake 后计入 skipped，不重复执行后续阶段。

- [ ] **Step 5: 运行兼容测试**

Run:

```bash
pnpm build
node --test --test-name-pattern="knowledge intake exposes|knowledge init leaves imported|knowledge CLI initializes" test/knowledge.test.mjs
node --test --test-name-pattern="knowledge pipeline reports" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/knowledge/ingest.ts src/knowledge/index.ts src/onboarding/knowledge-pipeline.ts test/knowledge.test.mjs test/onboarding.test.mjs
git commit -m "refactor: expose staged knowledge ingestion"
```

## Task 6: 实现质量门禁自动审批与发布

**Files:**
- Modify: `src/knowledge/publish.ts`
- Modify: `src/knowledge/index.ts`
- Modify: `src/onboarding/knowledge-pipeline.ts`
- Modify: `test/knowledge.test.mjs`
- Test: `test/onboarding.test.mjs`

- [ ] **Step 1: 写 clean/warn/error 发布测试**

```js
import { approveQualityCleanDraftSlices } from '../dist/knowledge/index.js';

test('quality-clean auto approval publishes only slices without warn or error issues', () => {
  const workspace = tempWorkspace();
  try {
    const draftsRoot = join(workspace, 'knowledge', '_pipeline', 'drafts', 'src_gate');
    mkdirSync(draftsRoot, { recursive: true });
    writeFileSync(join(draftsRoot, '001-clean.md'), approvedDraftMarkdown('clean', 'draft', 'unchecked'), 'utf8');
    writeFileSync(join(draftsRoot, '002-warned.md'), approvedDraftMarkdown('warned', 'draft', 'unchecked'), 'utf8');
    writeFileSync(join(draftsRoot, '003-broken.md'), approvedDraftMarkdown('broken', 'draft', 'unchecked'), 'utf8');
    const report = emptyQualityReport(workspace);
    report.issues = [
      { documentId: 'warned', severity: 'warn', code: 'too_short', message: 'too short' },
      { documentId: 'broken', severity: 'error', code: 'missing_source_blocks', message: 'missing blocks' },
    ];
    report.severityCounts = { info: 0, warn: 1, error: 1 };
    writeKnowledgeQualityReport({ workspaceRoot: workspace, report });

    const approval = approveQualityCleanDraftSlices({
      workspaceRoot: workspace,
      reviewer: 'super-helper-onboarding',
    });
    const published = publishApprovedDraftSlices({ workspaceRoot: workspace, qualityGate: 'strict' });

    assert.deepEqual(approval.approvedIds, ['clean']);
    assert.deepEqual(approval.pendingReviewIds, ['warned']);
    assert.deepEqual(approval.blockedIds, ['broken']);
    assert.deepEqual(published.publishedIds, ['clean']);
  } finally {
    cleanup(workspace);
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="quality-clean auto approval" test/knowledge.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 实现自动审批 helper**

新增：

```ts
export interface QualityAutoApprovalResult {
  approvedIds: string[];
  pendingReviewIds: string[];
  blockedIds: string[];
}

export function approveQualityCleanDraftSlices(input: {
  workspaceRoot: string;
  reviewer: string;
}): QualityAutoApprovalResult;
```

判定规则：

- slice 本身或所属 source 存在 `error`：blocked。
- slice 本身或所属 source 存在 `warn`：pending review。
- 没有 warn/error：按 source 分组调用 `reviewDraftSlices({ action: 'approve', ids })`。
- 不调用 `accept_warnings`。
- 不使用 `legacyActivePublish`。

- [ ] **Step 4: 接入 pipeline**

`audit_slices` 完成后执行：

```ts
const approval = approveQualityCleanDraftSlices({
  workspaceRoot,
  reviewer: 'super-helper-onboarding',
});
const publish = publishApprovedDraftSlices({
  workspaceRoot,
  qualityGate: 'strict',
});
```

将 `approvedIds/pendingReviewIds/blockedIds` 数量写入 run counters。

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm build
node --test --test-name-pattern="quality-clean auto approval|knowledge publish" test/knowledge.test.mjs
node --test --test-name-pattern="knowledge pipeline reports" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/knowledge/publish.ts src/knowledge/index.ts src/onboarding/knowledge-pipeline.ts test/knowledge.test.mjs test/onboarding.test.mjs
git commit -m "feat: auto publish quality-clean knowledge"
```

## Task 7: 为向量构建加入真实批次进度与兼容跳过

**Files:**
- Modify: `src/knowledge/vector-index.ts`
- Modify: `src/onboarding/knowledge-pipeline.ts`
- Modify: `test/knowledge-vector.test.mjs`
- Test: `test/onboarding.test.mjs`

- [ ] **Step 1: 写向量进度测试**

```js
test('vector builder reports completed eligible batches', async () => {
  const { workspace, indexes } = tempWorkspace();
  try {
    writeChunks(indexes, Array.from({ length: 5 }, (_, index) => ({
      chunk_id: `chk_${index}`,
      parent_id: `doc_${index}`,
      source: `knowledge/faq/${index}.md`,
      module: 'general',
      intent: 'how_to',
      source_type: 'faq',
      status: 'active',
      confidence: 'high',
      visibility: 'internal',
      headings: [],
      keywords: ['test'],
      text: `answer-bearing chunk ${index}`,
    })));
    const progress = [];
    const config = {
      enabled: true,
      provider: 'fake',
      model: 'fake-vector',
      dimensions: 4,
      distance: 'cosine',
      batchSize: 2,
    };
    await buildKnowledgeVectorIndex({
      workspaceRoot: workspace,
      provider: createEmbeddingProvider(config),
      config,
      onProgress: (item) => progress.push(item),
    });
    assert.deepEqual(progress.at(-1), { processed: 5, total: 5 });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
```

同时在 `test/knowledge-vector.test.mjs` 的 `node:fs` import 中加入 `rmSync`。

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="reports completed eligible batches" test/knowledge-vector.test.mjs
```

Expected: FAIL，`onProgress` 尚不支持。

- [ ] **Step 3: 修改向量构建接口**

扩展：

```ts
export interface BuildKnowledgeVectorIndexInput {
  workspaceRoot: string;
  provider: EmbeddingProvider;
  config: EmbeddingProviderConfig;
  onProgress?: (progress: { processed: number; total: number }) => void;
}
```

不要一次将全部 eligible inputs 交给 provider。按 `config.batchSize ?? 16` 分批调用 `embedDocuments()`，每批完成后调用 `onProgress`。保持现有报告、manifest 和失败脱敏行为。

- [ ] **Step 4: Pipeline 先做兼容检查**

`build_vector_index`：

- embedding disabled 或 draft 关闭向量：skipped。
- `checkKnowledgeVectorCompatibility()` 为 compatible：skipped。
- 否则构建，并把 batch progress 映射为 stage progress。

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm build
node --test test/knowledge-vector.test.mjs
node --test --test-name-pattern="planner skips unchanged" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/knowledge/vector-index.ts src/onboarding/knowledge-pipeline.ts test/knowledge-vector.test.mjs test/onboarding.test.mjs
git commit -m "feat: report vector build progress"
```

## Task 8: 实现进度 Hub、Runner 和失败恢复

**Files:**
- Create: `src/onboarding/progress.ts`
- Create: `src/onboarding/config-commit.ts`
- Create: `src/onboarding/runner.ts`
- Modify: `src/onboarding/run-repository.ts`
- Modify: `src/onboarding/types.ts`
- Test: `test/onboarding.test.mjs`

- [ ] **Step 1: 写 runner 状态机测试**

```js
import {
  buildOnboardingPlan,
  createOnboardingRun,
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
  OnboardingProgressHub,
  OnboardingRunner,
} from '../dist/onboarding/index.js';
import { defaultConfig } from '../dist/config.js';
import { onboardingDraftFixture } from './helpers/onboarding-fixtures.mjs';

test('runner persists real progress and commits only after health succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const order = [];
    const drafts = new FileOnboardingDraftRepository(root);
    const runs = new FileOnboardingRunRepository(root);
    const progress = new OnboardingProgressHub();
    const draft = drafts.save(onboardingDraftFixture({ revision: 0 }));
    const run = createOnboardingRun({
      id: 'run_success',
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: { added: ['a.md'], changed: [], unchanged: [] },
        keywordIndexDirty: true,
        vectorCompatibility: 'missing-index',
      }),
      now: '2026-06-15T00:00:00.000Z',
    });
    runs.save(run);
    const runner = new OnboardingRunner({
      drafts,
      runs,
      progress,
      validate: async () => order.push('validate'),
      testProviders: async () => order.push('providers'),
      prepareWorkspace: async () => order.push('prepare'),
      runKnowledge: async ({ report }) => {
        order.push('knowledge');
        report({ stage: 'slice_sources', processed: 2, total: 4, message: '2/4' });
        return { draftSlices: 4 };
      },
      healthCheck: async () => (order.push('health'), { ok: true }),
      commitConfig: async () => {
        order.push('commit');
        return { ...defaultConfig(), onboarding: { version: 1, lastRunId: run.id } };
      },
      onConfigCommitted: async () => order.push('reload'),
    });
    const completed = await runner.execute(run);
    assert.equal(completed.status, 'completed');
    assert.deepEqual(order, ['validate', 'providers', 'prepare', 'knowledge', 'health', 'commit', 'reload']);
    assert.equal(runs.load(run.id).overallProgress, 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runner failure preserves old config and retries from failed stage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    let attempts = 0;
    const drafts = new FileOnboardingDraftRepository(root);
    const runs = new FileOnboardingRunRepository(root);
    const progress = new OnboardingProgressHub();
    const draft = drafts.save(onboardingDraftFixture({ revision: 0 }));
    const run = createOnboardingRun({
      id: 'run_retry',
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: { added: ['a.md'], changed: [], unchanged: [] },
        keywordIndexDirty: true,
        vectorCompatibility: 'missing-index',
      }),
      now: '2026-06-15T00:00:00.000Z',
    });
    runs.save(run);
    const commitCalls = [];
    const runner = new OnboardingRunner({
      drafts,
      runs,
      progress,
      validate: async () => undefined,
      testProviders: async () => ({ ok: true }),
      prepareWorkspace: async () => undefined,
      runKnowledge: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('slice failed');
        return {};
      },
      healthCheck: async () => ({ ok: true }),
      commitConfig: async () => {
        commitCalls.push('commit');
        return defaultConfig();
      },
    });
    const failed = await runner.execute(run);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.retryableStage, 'ingest_sources');
    assert.equal(commitCalls.length, 0);

    const completed = await runner.retry(failed.id);
    assert.equal(completed.status, 'completed');
    assert.equal(commitCalls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="runner persists|runner failure" test/onboarding.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 实现 Progress Hub**

`OnboardingProgressHub` 使用 `EventEmitter`：

```ts
subscribe(runId: string, listener: (event: OnboardingProgressEvent) => void): () => void;
publish(event: OnboardingProgressEvent): void;
```

阶段权重：

```ts
const STAGE_WEIGHTS: Record<OnboardingStageId, number> = {
  validate_draft: 3,
  test_providers: 7,
  prepare_workspace: 5,
  ingest_sources: 8,
  extract_sources: 12,
  normalize_sources: 10,
  slice_sources: 15,
  audit_slices: 8,
  publish_approved: 7,
  build_keyword_index: 8,
  build_vector_index: 10,
  health_check: 5,
  commit_config: 2,
};
```

总体进度是已完成权重加当前阶段 `progress` 的加权值。skipped 阶段计为完成，但事件类型为 `stage.skipped`。

- [ ] **Step 4: 实现 runner**

导出 `createOnboardingRun()`：

```ts
export function createOnboardingRun(input: {
  id: string;
  draft: OnboardingDraft;
  plan: OnboardingPlan;
  now: string;
}): OnboardingRun {
  return {
    id: input.id,
    status: 'pending',
    draftRevision: input.draft.revision,
    overallProgress: 0,
    stages: input.plan.stages.map((stage) => ({
      id: stage.id,
      status: 'pending',
      progress: 0,
      total: stage.total,
      message: stage.reason,
    })),
    counters: {},
    startedAt: input.now,
    updatedAt: input.now,
  };
}
```

Runner 构造函数注入：

```ts
interface OnboardingRunnerDependencies {
  drafts: FileOnboardingDraftRepository;
  runs: FileOnboardingRunRepository;
  progress: OnboardingProgressHub;
  validate(draft: OnboardingDraft): Promise<void>;
  testProviders(draft: OnboardingDraft): Promise<unknown>;
  prepareWorkspace(draft: OnboardingDraft): Promise<void>;
  runKnowledge(input: {
    draft: OnboardingDraft;
    startStage?: OnboardingStageId;
    report(progress: KnowledgeStageProgress): void;
  }): Promise<Record<string, number>>;
  healthCheck(draft: OnboardingDraft): Promise<Record<string, unknown>>;
  commitConfig(draft: OnboardingDraft, runId: string): Promise<SuperHelperConfig>;
  onConfigCommitted?(config: SuperHelperConfig): Promise<void> | void;
}
```

要求：

- 所有阶段开始/进度/完成都先写 run repository，再 publish。
- catch 后写 safe error，设置 retryableStage。
- 调用整段知识 adapter 前先把 `currentStage` 持久化为 `ingest_sources`；adapter 后续通过 `report()` 将其推进到真实子阶段，因此在首次 adapter 调用即抛错时也能从 `ingest_sources` 重试。
- retry 复制失败 run 的已完成阶段，只重置失败阶段及其后续阶段。
- 同一时间只允许一个 active run。
- provider test 失败阻止知识处理。
- config commit 必须最后执行。
- config commit 返回新的正式配置，并在 run 完成前调用 `onConfigCommitted` 热重载当前进程。

- [ ] **Step 5: 实现 config commit**

`commitOnboardingConfig()` 从 draft 生成新的 `SuperHelperConfig`，合并旧配置中 MCP、Claude allowlist 等未在 Setup 修改的字段，写入：

```ts
onboarding: {
  version: 1,
  completedAt: new Date().toISOString(),
  lastRunId: runId,
}
```

使用 `saveConfig()` 原子替换。

`commitOnboardingConfig()` 返回已经写入的 `SuperHelperConfig`。Runner 调用 `onConfigCommitted` 成功后才能把 run 标记为 completed；热重载失败时 run 标记 failed，不能让 Setup 页面跳转到使用旧配置的 Dashboard。

- [ ] **Step 6: 运行测试**

Run:

```bash
pnpm build && node --test --test-name-pattern="runner persists|runner failure" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/onboarding/progress.ts src/onboarding/config-commit.ts src/onboarding/runner.ts src/onboarding/run-repository.ts src/onboarding/types.ts src/onboarding/index.ts test/onboarding.test.mjs
git commit -m "feat: run recoverable onboarding jobs"
```

## Task 9: 实现 OnboardingService 和安全 DTO

**Files:**
- Create: `src/onboarding/service.ts`
- Modify: `src/onboarding/secrets.ts`
- Modify: `src/onboarding/index.ts`
- Test: `test/onboarding.test.mjs`

- [ ] **Step 1: 写 service 草稿保存和单 active run 测试**

```js
import {
  FileOnboardingDraftRepository,
  FileOnboardingRunRepository,
  FileSecretsRepository,
  OnboardingProgressHub,
  OnboardingService,
} from '../dist/onboarding/index.js';
import { defaultConfig } from '../dist/config.js';
import { draftInputFixture } from './helpers/onboarding-fixtures.mjs';

function createServiceFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-service-'));
  const drafts = new FileOnboardingDraftRepository(root);
  const runs = new FileOnboardingRunRepository(root);
  const secrets = new FileSecretsRepository(root);
  const progress = new OnboardingProgressHub();
  const runner = {
    async execute(run) {
      if (options.runnerNeverCompletes) return new Promise(() => {});
      return runs.save({
        ...run,
        status: 'completed',
        overallProgress: 100,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    },
    async retry(id) {
      return this.execute(runs.load(id));
    },
  };
  const config = defaultConfig();
  config.storage.rootDir = root;
  return {
    root,
    secretsPath: join(root, 'secrets.json'),
    service: new OnboardingService({
      config,
      drafts,
      runs,
      secrets,
      progress,
      runner,
      validate: () => ({ ok: true, issues: [] }),
    }),
  };
}

test('service stores input secrets as refs and exposes only sanitized draft', async () => {
  const fixture = createServiceFixture();
  try {
    const state = await fixture.service.saveDraft({
      ...draftInputFixture(),
      secrets: {
        agentApiKey: 'agent-secret',
        embeddingApiKey: 'embedding-secret',
        rerankApiKey: 'rerank-secret',
      },
    });
    assert.equal(state.draft.agent.provider.hasApiKey, true);
    assert.equal(JSON.stringify(state).includes('agent-secret'), false);
    assert.equal(readFileSync(fixture.secretsPath, 'utf8').includes('agent-secret'), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('service rejects a second active onboarding run', async () => {
  const fixture = createServiceFixture({ runnerNeverCompletes: true });
  try {
    await fixture.service.saveDraft(draftInputFixture());
    await fixture.service.startRun();
    await assert.rejects(() => fixture.service.startRun(), /already active/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="service stores|second active" test/onboarding.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 定义输入 DTO 和脱敏状态**

在 types 中明确输入 DTO 不允许提交明文 key 或内部 file SecretRef；高级设置只允许提交 env SecretRef，file SecretRef 必须由 service 根据 `secrets` 字段生成：

```ts
import type { SecretRef } from '../domain.js';

type EnvSecretRef = Extract<SecretRef, { source: 'env' }>;
type OnboardingModelProviderInput =
  Omit<ModelProviderConfig, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & {
    apiKeyRef?: EnvSecretRef;
  };
type OnboardingEmbeddingInput =
  Omit<EmbeddingProviderConfig, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & {
    apiKeyRef?: EnvSecretRef;
  };
type OnboardingRerankInput =
  Omit<RerankProviderConfig, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & {
    apiKeyRef?: EnvSecretRef;
  };

export interface OnboardingDraftInput {
  draft: Omit<OnboardingDraft, 'revision' | 'updatedAt' | 'agent' | 'embedding' | 'rerank'> & {
    agent: {
      providerId: string;
      provider: OnboardingModelProviderInput;
    };
    embedding: OnboardingEmbeddingInput;
    rerank: OnboardingRerankInput;
  };
  secrets?: {
    agentApiKey?: string;
    embeddingApiKey?: string;
    rerankApiKey?: string;
  };
}

export interface PublicOnboardingState {
  completed: boolean;
  draft?: Record<string, unknown>;
  latestRun?: OnboardingRun;
}
```

Public draft 只返回 provider metadata、SecretRef source 和 `hasApiKey`，不返回 file key 对应值。

- [ ] **Step 4: 实现 Service**

公共方法：

```ts
constructor(input: {
  config: SuperHelperConfig;
  drafts: FileOnboardingDraftRepository;
  runs: FileOnboardingRunRepository;
  secrets: FileSecretsRepository;
  progress: OnboardingProgressHub;
  runner: Pick<OnboardingRunner, 'execute' | 'retry'>;
  validate(draft: OnboardingDraft): OnboardingValidationResult;
});
getState(): PublicOnboardingState;
saveDraft(input: OnboardingDraftInput): Promise<PublicOnboardingState>;
validateDraft(): Promise<OnboardingValidationResult>;
startRun(): Promise<OnboardingRun>;
getRun(id: string): OnboardingRun | undefined;
retryRun(id: string): Promise<OnboardingRun>;
subscribe(id: string, listener: (event: OnboardingProgressEvent) => void): () => void;
recoverInterrupted(): OnboardingRun[];
```

`startRun()` 返回持久化的 pending/running 快照，并使用 `queueMicrotask(() => void runner.execute(run))` 在请求结束后继续。

同时导出组合工厂：

```ts
export function createOnboardingService(input: {
  config: SuperHelperConfig;
  onConfigCommitted?(config: SuperHelperConfig): Promise<void> | void;
}): OnboardingService;
```

工厂负责创建 secrets/draft/run repositories、progress hub、provider tests、knowledge adapter、runner 和 config commit。`startServer()` 默认使用这个工厂，测试仍可注入 fake service。

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm build && node --test --test-name-pattern="service stores|second active" test/onboarding.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/onboarding/service.ts src/onboarding/secrets.ts src/onboarding/types.ts src/onboarding/index.ts test/onboarding.test.mjs
git commit -m "feat: expose onboarding application service"
```

## Task 10: 增加 Onboarding API 和 SSE

**Files:**
- Create: `src/gateway/routes/onboarding-routes.ts`
- Create: `src/gateway/application-context.ts`
- Modify: `src/gateway/http-utils.ts`
- Modify: `src/gateway/http-server.ts`
- Test: `test/onboarding-http.test.mjs`

- [ ] **Step 1: 写 HTTP/SSE 集成测试**

```js
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig } from '../dist/config.js';
import { startServer } from '../dist/server.js';
import { draftInputFixture } from './helpers/onboarding-fixtures.mjs';

class FakeOnboardingService {
  constructor(completed = false) {
    this.completed = completed;
    this.draft = undefined;
    this.run = undefined;
    this.listeners = new Set();
  }
  getState() {
    return { completed: this.completed, draft: this.draft, latestRun: this.run };
  }
  async saveDraft(input) {
    this.draft = {
      ...input.draft,
      agent: {
        ...input.draft.agent,
        provider: { ...input.draft.agent.provider, hasApiKey: Boolean(input.secrets?.agentApiKey) },
      },
    };
    return this.getState();
  }
  async validateDraft() {
    return { ok: true, issues: [] };
  }
  async startRun() {
    this.run = {
      id: 'run_http',
      status: 'running',
      draftRevision: 1,
      overallProgress: 1,
      stages: [],
      counters: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.run;
  }
  getRun(id) {
    return this.run?.id === id ? this.run : undefined;
  }
  async retryRun(id) {
    if (!this.getRun(id)) throw new Error('run not found');
    return this.startRun();
  }
  subscribe(_id, listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  completeRun() {
    this.run = {
      ...this.run,
      status: 'completed',
      overallProgress: 100,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      listener({ type: 'run.completed', runId: this.run.id, at: this.run.updatedAt, run: this.run });
    }
  }
}

async function startOnboardingServer(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-http-'));
  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge');
  config.server.host = '127.0.0.1';
  config.server.port = 0;
  if (options.completed) config.onboarding.completedAt = new Date().toISOString();
  const service = new FakeOnboardingService(Boolean(options.completed));
  const server = await startServer({ config, onboarding: service });
  return {
    ...server,
    root,
    service,
    startRun: () => service.startRun(),
    completeRun: () => service.completeRun(),
    async close() {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('onboarding HTTP API saves draft, starts run, and restores snapshot', async () => {
  const fixture = await startOnboardingServer();
  try {
    const saved = await fetch(`${fixture.url}/api/onboarding/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draftInputFixture()),
    }).then((res) => res.json());
    assert.equal(saved.draft.workspace.name, 'Demo');

    const started = await fetch(`${fixture.url}/api/onboarding/runs`, {
      method: 'POST',
    }).then((res) => res.json());
    assert.equal(started.run.status, 'running');

    const restored = await fetch(`${fixture.url}/api/onboarding/runs/${started.run.id}`).then((res) => res.json());
    assert.equal(restored.run.id, started.run.id);
  } finally {
    await fixture.close();
  }
});

test('onboarding SSE emits named progress events and disconnect does not cancel run', async () => {
  const fixture = await startOnboardingServer();
  try {
    const run = await fixture.startRun();
    const response = await fetch(`${fixture.url}/api/onboarding/runs/${run.id}/events`);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: (run|stage)\./);
    await reader.cancel();
    await fixture.completeRun();
    assert.equal(fixture.service.getRun(run.id).status, 'completed');
  } finally {
    await fixture.close();
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test test/onboarding-http.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 增加 HTTP helpers**

`src/gateway/http-utils.ts` 新增：

```ts
export function sendRedirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

export function startEventStream(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
}

export function writeEvent(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
```

- [ ] **Step 4: 实现 routes**

路由严格映射设计 API：

```text
GET  /api/onboarding
PUT  /api/onboarding/draft
POST /api/onboarding/validate
POST /api/onboarding/runs
GET  /api/onboarding/runs/:id
GET  /api/onboarding/runs/:id/events
POST /api/onboarding/runs/:id/retry
```

同时增加匿名最小健康接口：

```text
GET /api/health
```

固定只返回：

```json
{
  "ok": true,
  "service": "super-helper"
}
```

不得返回路径、provider、模型、SecretRef 或知识统计。

错误状态：

- 400：草稿输入/校验错误。
- 404：run 不存在。
- 409：已有 active run 或 run 不可重试。
- 500：仅返回安全错误。

SSE route：

- 先写当前 run snapshot 事件。
- 订阅 hub。
- `req.on('close')` 只 unsubscribe，不取消 run。
- 每 15 秒发送 heartbeat comment。

- [ ] **Step 5: 注入 service**

扩展：

```ts
export interface StartServerOptions {
  config: SuperHelperConfig;
  onboarding?: OnboardingService;
}
```

默认由 `startServer()` 根据 `config.storage.rootDir` 创建 service；测试可注入 fake service。

新增 `src/gateway/application-context.ts`：

```ts
import { SuperHelperAgent } from '../agent.js';
import { ClaudeCodeWorker } from '../claude-worker.js';
import type { SuperHelperConfig } from '../config.js';
import { resolveSessionStorageRoot } from '../sessions/storage-scope.js';
import { FileMemoryStore } from '../storage.js';

export class GatewayApplicationContext {
  config: SuperHelperConfig;
  store: FileMemoryStore;
  agent: SuperHelperAgent;

  constructor(config: SuperHelperConfig) {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new SuperHelperAgent(config, this.store, new ClaudeCodeWorker(config));
  }

  reload(config: SuperHelperConfig): void {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new SuperHelperAgent(config, this.store, new ClaudeCodeWorker(config));
  }
}
```

`http-server.ts` 每个请求都读取 context 当前的 `config/store/agent`，不能继续闭包捕获启动时对象。Onboarding runner 的 `onConfigCommitted` 回调执行：

```ts
context.reload(materializeConfigSecrets(nextConfig, secrets));
```

这样 `onboard` 成功跳转后立即使用新 workspace、session storage 和 provider 配置，不要求用户重启命令。

`server.listen()` 完成后通过 `server.address()` 读取实际端口，保证测试和用户显式传 `--port 0` 时返回的 URL 不是错误的 `:0`。

- [ ] **Step 6: 运行测试**

Run:

```bash
pnpm build && node --test test/onboarding-http.test.mjs
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/gateway/http-utils.ts src/gateway/http-server.ts src/gateway/application-context.ts src/gateway/routes/onboarding-routes.ts test/onboarding-http.test.mjs
git commit -m "feat: expose onboarding API and SSE"
```

## Task 11: 实现 Setup Dashboard 和配置完成跳转

**Files:**
- Create: `src/setup-ui.ts`
- Modify: `src/gateway/http-server.ts`
- Modify: `src/ui.ts`
- Test: `test/onboarding-http.test.mjs`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写 Setup UI 和 redirect 测试**

```js
import { renderSetupApp } from '../dist/setup-ui.js';

test('setup UI contains QuickStart, advanced settings, progress, and retry controls', () => {
  const html = renderSetupApp();
  assert.match(html, /QuickStart/);
  assert.match(html, /高级设置/);
  assert.match(html, /检查并执行/);
  assert.match(html, /EventSource/);
  assert.match(html, /从失败阶段重试/);
  assert.match(html, /可信内网/);
});

test('root redirects to setup until onboarding is completed', async () => {
  const fixture = await startOnboardingServer({ completed: false });
  try {
    const response = await fetch(`${fixture.url}/`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/setup');
  } finally {
    await fixture.close();
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="setup UI|redirects to setup" test/onboarding-http.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 实现 `renderSetupApp()`**

页面必须包含：

- QuickStart：workspace、sourceDir、Agent preset/key、Embedding/Rerank preset/key。
- 折叠高级设置。
- 预检结果。
- run 阶段列表、真实百分比、processed/total。
- 自动发布、待审核、blocked 计数。
- SSE 断开后的轮询恢复。
- retry 按钮。
- 完成页和“进入 Dashboard”。
- bindMode=lan 时显示“当前页面和 API 暴露在可信内网，MVP 尚未实现鉴权”。

JS 流程：

```text
GET /api/onboarding
→ 预填
→ PUT draft
→ POST validate
→ POST runs
→ GET snapshot
→ EventSource events
→ completed 后 location.href = '/'
```

不要在 HTML 中存储 API Key 到 localStorage。

- [ ] **Step 4: 路由页面**

`GET /setup` 返回 Setup UI。

`GET /`：

- `onboarding.completedAt` 缺失：302 `/setup`。
- 已完成：返回 `renderApp()`。

日常 Dashboard 设置面板保存 provider 变化时继续可用，但必须复用 SecretRef repository，禁止明文写 config。

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm build
node --test --test-name-pattern="setup UI|redirects to setup" test/onboarding-http.test.mjs
node --test --test-name-pattern="settings API sanitizes|app exposes a model" test/supper-helper.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/setup-ui.ts src/gateway/http-server.ts src/ui.ts test/onboarding-http.test.mjs test/supper-helper.test.mjs
git commit -m "feat: add dashboard onboarding wizard"
```

## Task 12: 让旧 Settings API 使用 SecretRef

**Files:**
- Modify: `src/gateway/routes/settings-routes.ts`
- Modify: `src/gateway/dto.ts`
- Modify: `src/gateway/http-server.ts`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: 写 config 不落明文回归测试**

```js
test('settings API stores submitted keys in secrets file instead of config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-helper-test-'));
  let server;
  try {
    const config = baseConfig(dir);
    config.server.port = 0;
    server = await startServer({ config });
    await fetch(`${server.url}/api/settings/model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'default',
        baseUrl: 'https://api.test/v1',
        model: 'test-model',
        apiKey: 'submitted-secret',
      }),
    });
    assert.doesNotMatch(readFileSync(join(dir, 'config.json'), 'utf8'), /submitted-secret/);
    assert.match(readFileSync(join(dir, 'secrets.json'), 'utf8'), /submitted-secret/);
  } finally {
    if (server) await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test --test-name-pattern="stores submitted keys" test/supper-helper.test.mjs
```

Expected: FAIL，当前 route 将 `apiKey` 写入 config。

- [ ] **Step 3: 注入 secrets repository**

`handleSettingsRoutes()` 增加 `FileSecretsRepository` 参数。收到 `apiKey` 时：

```ts
provider.apiKeyRef = secrets.set(`providers.agent.${providerId}`, body.apiKey);
provider.apiKey = body.apiKey; // 仅当前进程内存使用
```

Embedding/Rerank 使用固定 key：

```text
providers.embedding
providers.rerank
```

DTO `hasApiKey` 同时检查 `apiKey`、env 和 repository ref；响应不返回 ref key。

- [ ] **Step 4: 运行回归测试**

Run:

```bash
pnpm build && node --test --test-name-pattern="settings API sanitizes|stores submitted keys" test/supper-helper.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/gateway/routes/settings-routes.ts src/gateway/dto.ts src/gateway/http-server.ts test/supper-helper.test.mjs
git commit -m "fix: keep settings secrets out of config"
```

## Task 13: 实现网络绑定、打开浏览器和 CLI 子命令

**Files:**
- Create: `src/cli/args.ts`
- Create: `src/cli/index.ts`
- Create: `src/cli/bindings.ts`
- Create: `src/cli/open-browser.ts`
- Create: `src/cli/server-commands.ts`
- Create: `src/cli/status-command.ts`
- Create: `src/cli/doctor-command.ts`
- Modify: `src/cli.ts`
- Modify: `src/gateway/http-server.ts`
- Test: `test/onboarding-cli.test.mjs`

- [ ] **Step 1: 写 bind 和命令测试**

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  resolveServerBinding,
  runDoctorCommand,
  runStatusCommand,
} from '../dist/cli/index.js';
import { defaultConfig, saveConfig } from '../dist/config.js';
import { FileOnboardingRunRepository } from '../dist/onboarding/index.js';

test('binding resolves loopback, lan, and explicit host precedence', () => {
  assert.equal(resolveServerBinding({ bind: 'loopback' }).listenHost, '127.0.0.1');
  assert.equal(resolveServerBinding({ bind: 'lan' }).listenHost, '0.0.0.0');
  assert.equal(resolveServerBinding({ bind: 'lan', host: '192.168.1.20' }).listenHost, '192.168.1.20');
});

test('status reads persisted onboarding state without starting server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-cli-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.onboarding = {
      version: 1,
      completedAt: '2026-06-15T00:00:00.000Z',
      lastRunId: 'run_cli',
    };
    saveConfig(config, join(root, 'config.json'));
    const runs = new FileOnboardingRunRepository(root);
    runs.save({
      id: 'run_cli',
      status: 'completed',
      draftRevision: 1,
      overallProgress: 100,
      stages: [],
      counters: {},
      startedAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:01.000Z',
      completedAt: '2026-06-15T00:00:01.000Z',
    });
    const lines = [];
    await runStatusCommand({
      rootDir: root,
      probeHealth: async () => false,
      write: (line) => lines.push(line),
    });
    assert.ok(lines.some((line) => line.includes('onboarding: completed')));
    assert.ok(lines.some((line) => line.includes('knowledge:')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor reports actionable local checks without exposing secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-doctor-'));
  try {
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(workspaceRoot, { recursive: true });
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.knowledge.rootDir = join(root, 'knowledge');
    config.workspaces[0].rootPath = workspaceRoot;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'fake-agent',
      apiKeyRef: { source: 'env', name: 'SUPER_HELPER_TEST_KEY' },
    };
    config.agent.modelProvider = 'default';
    saveConfig(config, join(root, 'config.json'));
    const lines = [];
    const result = await runDoctorCommand({
      rootDir: root,
      env: { SUPER_HELPER_TEST_KEY: 'fixture-secret' },
      checkClaude: async () => ({ ok: true, version: 'test' }),
      probeHealth: async () => false,
      write: (line) => lines.push(line),
    });
    assert.equal(result.ok, true);
    assert.ok(lines.some((line) => line.includes('workspace: ok')));
    assert.equal(lines.join('\n').includes('fixture-secret'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

增加 CLI 子进程测试：

```js
test('dashboard lan uses 0.0.0.0 and prints MVP security warning', () => {
  const result = spawnSync(process.execPath, [
    'dist/cli.js',
    'dashboard',
    '--bind',
    'lan',
    '--no-open',
    '--dry-run',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0\.0\.0\.0/);
  assert.match(result.stdout, /可信内网/);
});
```

- [ ] **Step 2: 确认失败**

Run:

```bash
pnpm build && node --test test/onboarding-cli.test.mjs
```

Expected: FAIL。

- [ ] **Step 3: 实现 binding**

```ts
export function resolveServerBinding(input: {
  bind?: 'loopback' | 'lan';
  host?: string;
  port?: number;
}): {
  bindMode: 'loopback' | 'lan';
  listenHost: string;
  port: number;
  localUrl: string;
  warning?: string;
};
```

规则：

- explicit host 最高优先。
- lan -> `0.0.0.0`。
- local URL 在 listenHost 为 `0.0.0.0` 时使用 `127.0.0.1`。
- LAN 输出 `networkInterfaces()` 中可用 IPv4 内网地址。

- [ ] **Step 4: 实现浏览器打开 helper**

`openBrowser(url)`：

- macOS: `open <url>`
- Windows: `cmd /c start "" <url>`
- Linux: `xdg-open <url>`
- 使用 `spawn(..., { detached: true, stdio: 'ignore' }).unref()`。
- `--no-open` 跳过。
- 打开失败只警告，不关闭服务。

- [ ] **Step 5: 重构 CLI dispatcher**

`src/cli.ts` 保持薄入口：

```ts
const command = process.argv[2] ?? 'dashboard';
const argv = process.argv.slice(3);
switch (command) {
  case 'onboard':
    await runServerCommand({ mode: 'onboard', argv });
    return;
  case 'dashboard':
    await runServerCommand({ mode: 'dashboard', argv });
    return;
  case 'status':
    await runStatusCommand({ argv });
    return;
  case 'doctor':
    await runDoctorCommand({ argv });
    return;
  // 保留现有 knowledge/model/mcp 等高级命令。
}
```

`runServerCommand()`：

- 配置不存在时使用 default config，不先提交。
- 加载后执行 legacy secret migration。
- recover interrupted run。
- onboard 打开 `/setup`。
- dashboard 根据完成状态打开 `/` 或 `/setup`。
- 服务持续运行。
- `--dry-run` 只打印绑定和目标 URL，用于测试。

`runStatusCommand()` 是 async，只做 500ms 的 best-effort `GET /api/health` 探测；探测失败时仍从 `config.json`、knowledge manifest 和最近 run 文件输出持久化状态，不启动服务、不修改文件。

`runStatusCommand()` 的可测试入口：

```ts
runStatusCommand(input: {
  argv?: string[];
  rootDir?: string;
  probeHealth?: (url: string) => Promise<boolean>;
  write?: (line: string) => void;
}): Promise<void>;
```

`runDoctorCommand()` 执行本地诊断并返回 `{ ok: boolean; checks: DoctorCheck[] }`：

- config 是否存在且可解析。
- workspace 是否存在且为目录。
- storage/knowledge 父目录是否可创建或写入。
- Agent、启用的 Embedding/Rerank SecretRef 是否可解析；`fake` provider 免密。
- 最近 onboarding run 是否 failed/interrupted，并输出 retry 提示。
- keyword/vector manifest 与当前配置是否兼容。
- Claude 命令是否可用，保留现有 doctor 能力。
- 500ms best-effort `/api/health`，服务未运行只记 info，不导致失败。
- 默认不发远程 provider 请求；`--providers` 时复用 Task 4 smoke tests。
- 输出和返回结构都不得包含 secret value、Authorization header 或 file SecretRef key。

测试入口允许注入 `env/checkClaude/probeHealth/write`，CLI 入口从 `argv` 和真实环境构建这些依赖。

- [ ] **Step 6: 扩展 startServer URL**

返回：

```ts
{
  url: string;
  listenHost: string;
  port: number;
  close(): Promise<void>;
}
```

`0.0.0.0` 监听时 `url` 使用可访问的 `127.0.0.1`。

- [ ] **Step 7: 运行测试**

Run:

```bash
pnpm build && node --test test/onboarding-cli.test.mjs
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/cli.ts src/cli src/gateway/http-server.ts test/onboarding-cli.test.mjs
git commit -m "feat: add onboard dashboard and status commands"
```

## Task 14: 增加 pnpm 快捷命令和 README 主流程

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/standards/development.md`
- Modify: `docs/architecture/overview.md`

- [ ] **Step 1: 增加源码态命令**

`package.json`：

```json
{
  "scripts": {
    "onboard": "pnpm build && node dist/cli.js onboard",
    "dashboard": "pnpm build && node dist/cli.js dashboard",
    "status": "pnpm build && node dist/cli.js status",
    "doctor": "pnpm build && node dist/cli.js doctor"
  }
}
```

保留现有 knowledge、test、build 命令。

- [ ] **Step 2: 重写 README 快速开始**

README 开头主流程必须变为：

```bash
pnpm install
pnpm onboard
```

内网模式：

```bash
pnpm onboard -- --bind lan
```

日常启动：

```bash
pnpm dashboard
pnpm status
pnpm doctor
```

README 明确：

- Setup Dashboard 一次完成 workspace、知识、Agent、Embedding、Rerank。
- 高级细粒度 CLI 仍保留用于维护。
- LAN 当前无鉴权，只能在可信内网使用。
- 配置、secrets、onboarding runs 和知识库实际落盘位置。
- 不包含 `/Users/king/...` 等个人路径。

- [ ] **Step 3: 更新模块边界文档**

`docs/standards/development.md` 的 ownership map 增加：

```text
src/onboarding/ | Setup 草稿、run、进度、恢复和配置提交 | HTTP、产品诊断编排、provider 实现
```

`docs/architecture/overview.md` 增加 onboarding pipeline、SSE、SecretRef、LAN MVP 边界和 CLI 契约。

- [ ] **Step 4: 运行文档校验**

Run:

```bash
pnpm lint
```

Expected: `Docs lint passed...`

- [ ] **Step 5: 提交**

```bash
git add package.json README.md docs/standards/development.md docs/architecture/overview.md
git commit -m "docs: make dashboard onboarding the default setup"
```

## Task 15: 全链路验收与回归

**Files:**
- Modify: `test/onboarding.test.mjs`
- Modify: `test/onboarding-http.test.mjs`
- Modify: `test/onboarding-cli.test.mjs`
- Modify: `test/supper-helper.test.mjs`
- Modify: `test/knowledge.test.mjs`
- Modify: `test/embedding.test.mjs`
- Create: `test/helpers/full-onboarding-fixture.mjs`

- [ ] **Step 1: 增加一键成功场景**

先新增 `test/helpers/full-onboarding-fixture.mjs`。该 fixture 使用真实 `createOnboardingService()`、真实文件仓库和真实知识管线，只替换远程 Agent 请求；Embedding 使用仓库已有的 `fake` provider，Rerank 关闭：

```js
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadConfig } from '../../dist/config.js';
import { resolveKnowledgeWorkspaceRoot } from '../../dist/knowledge/index.js';
import { createOnboardingService } from '../../dist/onboarding/index.js';
import { draftInputFixture } from './onboarding-fixtures.mjs';

export async function fullOnboardingFixture({ sources }) {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-full-onboarding-'));
  const projectRoot = join(root, 'project');
  const sourceDir = join(root, 'sources');
  const configPath = join(root, 'config.json');
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  for (const [name, content] of Object.entries(sources)) {
    writeFileSync(join(sourceDir, name), content, 'utf8');
  }

  const config = defaultConfig();
  config.storage.rootDir = root;
  config.knowledge.rootDir = join(root, 'knowledge-store');
  config.server.port = 0;

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'provider smoke test ok' } }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  let runtimeConfig = config;
  const service = createOnboardingService({
    config,
    onConfigCommitted(nextConfig) {
      runtimeConfig = nextConfig;
    },
  });

  return {
    configPath,
    sourceDir,
    get knowledgeWorkspace() {
      const persisted = loadConfig(configPath);
      return resolveKnowledgeWorkspaceRoot(persisted, 'current');
    },
    get runtimeConfig() {
      return runtimeConfig;
    },
    async saveDraft() {
      return service.saveDraft({
        ...draftInputFixture({
          workspace: { id: 'current', name: 'Demo', rootPath: projectRoot },
          knowledge: {
            rootDir: join(root, 'knowledge-store'),
            sourceDir,
            buildVectorIndex: true,
          },
          server: { bindMode: 'loopback', port: 4317 },
          agent: {
            providerId: 'default',
            provider: {
              type: 'openai-compatible',
              baseUrl: 'https://api.example.test/v1',
              model: 'fake-agent',
            },
          },
          embedding: {
            enabled: true,
            provider: 'fake',
            model: 'fake-embedding',
            dimensions: 4,
            distance: 'cosine',
            batchSize: 2,
            timeoutMs: 1000,
          },
          rerank: { enabled: false },
        }),
        secrets: { agentApiKey: 'fixture-secret' },
      });
    },
    async startAndWait() {
      const started = await service.startRun();
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const run = service.getRun(started.id);
        if (run?.status === 'completed' || run?.status === 'failed') return run;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`onboarding run timed out: ${started.id}`);
    },
    async close() {
      globalThis.fetch = previousFetch;
      rmSync(root, { recursive: true, force: true });
    },
  };
}
```

若现有模型 client 要求额外 response 字段，fixture 只补足该 client 实际解析的最小 OpenAI-compatible 响应，不绕过 `testAgentProvider()`。

集成测试使用该 fixture 和临时 sourceDir：

```js
import { fullOnboardingFixture } from './helpers/full-onboarding-fixture.mjs';

test('one dashboard run configures providers, publishes clean knowledge, and commits config', async () => {
  const fixture = await fullOnboardingFixture({
    sources: {
      'guide.md': [
        '# 产品配置指南',
        '',
        '## 可回答的问题',
        '本指南用于回答如何完成项目初始化、模型配置和知识库构建。',
        '',
        '## 核心步骤',
        '先选择工作区和知识源目录，再配置 Agent 与 Embedding，最后执行健康检查并提交配置。',
        '',
        '## 适用范围',
        '适用于可信内网中的 MVP 部署；当前版本不提供访问令牌鉴权。',
        '',
        '## 原文来源',
        '内部产品配置规范 2026-06-15。',
      ].join('\n'),
    },
  });
  try {
    await fixture.saveDraft();
    const run = await fixture.startAndWait();
    assert.equal(run.status, 'completed');
    assert.equal(run.overallProgress, 100);
    assert.ok(run.counters.autoPublished >= 1);
    assert.equal(JSON.parse(readFileSync(fixture.configPath, 'utf8')).onboarding.lastRunId, run.id);
    assert.doesNotMatch(readFileSync(fixture.configPath, 'utf8'), /fixture-secret/);
    assert.equal(existsSync(join(fixture.knowledgeWorkspace, 'knowledge', 'indexes', 'manifest.json')), true);
  } finally {
    await fixture.close();
  }
});
```

- [ ] **Step 2: 增加失败与刷新恢复场景**

覆盖：

- Provider 测试失败不提交 config。
- 切片阶段失败，旧 config 保持。
- GET run 可恢复最新进度。
- SSE 断开后 run 继续。
- retry 从失败阶段继续。
- 服务重启将 running 标记 interrupted。

- [ ] **Step 3: 增加重复 onboard 增量场景**

执行两次：

- 第一次处理 2 个 source。
- 第二次 source 未变化，`ingest/extract/normalize/slice` 全部 skipped。
- 修改其中 1 个 source 后第三次只处理 1 个。
- compatible vector manifest 时跳过 vector build。

- [ ] **Step 4: 增加公开响应泄密扫描**

对以下 JSON/文本断言不包含 fixture secrets：

```text
GET /api/settings
GET /api/onboarding
GET /api/onboarding/runs/:id
SSE event data
status output
doctor output
run JSON
config JSON
```

- [ ] **Step 5: 运行完整验证**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Expected: 全部通过。

- [ ] **Step 6: 手工冒烟**

Run:

```bash
pnpm onboard -- --no-open
```

检查终端打印 `/setup` URL。

另一个终端：

```bash
pnpm status
```

完成 Setup 后检查：

```bash
pnpm dashboard -- --bind lan --no-open
```

Expected:

- 监听 `0.0.0.0`。
- 打印本机和内网 URL。
- 打印 MVP 无鉴权警告。
- `/` 显示日常 Dashboard。

- [ ] **Step 7: 最终提交**

```bash
git add test src package.json README.md docs
git commit -m "test: verify dashboard onboarding workflow"
```

## 实施顺序与检查点

建议按下面四个检查点执行：

1. **数据基础**：Task 1-3。SecretRef、草稿、run、validator、planner。
2. **执行引擎**：Task 4-9。Provider、知识阶段、质量门禁、runner、service。
3. **产品入口**：Task 10-14。API/SSE、Setup UI、CLI、README。
4. **验收**：Task 15。全链路、泄密扫描、LAN 冒烟。

每个检查点结束后运行：

```bash
pnpm typecheck
pnpm build
pnpm test
```

不得在检查点失败时继续堆叠后续 UI 或 CLI 改动。
