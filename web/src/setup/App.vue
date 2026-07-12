<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import PathDialog from './PathDialog.vue';
import ReviewPanel from './ReviewPanel.vue';
import { useOnboarding } from './use-onboarding';

const onboarding = useOnboarding();
const form = reactive({
  workspacePath: '', knowledgeRoot: '', sourceDir: '', bindMode: 'loopback', port: 4317,
  agentBaseUrl: 'https://api.minimaxi.com/v1', agentModel: 'MiniMax-M3', agentKey: '',
  embeddingBaseUrl: 'https://api.siliconflow.cn/v1', embeddingModel: 'Qwen/Qwen3-Embedding-0.6B', embeddingKey: '', dimensions: 1024, batchSize: 16,
  rerankBaseUrl: 'https://api.siliconflow.cn/v1', rerankModel: 'BAAI/bge-reranker-v2-m3', rerankKey: '', topN: 8,
});
const savedApiKeys = reactive({ agent: false, embedding: false, rerank: false });
const advanced = ref(false);
const pickerOpen = ref(false);
const pickerField = ref<'workspacePath' | 'knowledgeRoot' | 'sourceDir'>('workspacePath');
const pickerOpener = ref<HTMLElement>();
const validationText = computed(() => onboarding.validation.value ? JSON.stringify(onboarding.validation.value, null, 2) : '等待预检结果…');
const onboardingCompleted = computed(() => onboarding.snapshot.value.completed === true || onboarding.run.value?.status === 'completed');

onMounted(async () => {
  try {
    const state = await onboarding.load();
    hydrate((state as any).draft);
    if ((state as any).review?.required) await onboarding.loadReview();
  } catch { /* visible banner */ }
});
onBeforeUnmount(onboarding.close);

function hydrate(draft?: Record<string, any>): void {
  if (!draft) return;
  form.workspacePath = draft.workspace?.rootPath ?? form.workspacePath;
  form.knowledgeRoot = draft.knowledge?.rootDir ?? form.knowledgeRoot;
  form.sourceDir = draft.knowledge?.sourceDir ?? form.sourceDir;
  form.bindMode = draft.server?.bindMode ?? form.bindMode;
  form.port = draft.server?.port ?? form.port;
  form.agentBaseUrl = draft.agent?.provider?.baseUrl ?? form.agentBaseUrl;
  form.agentModel = draft.agent?.provider?.model ?? form.agentModel;
  savedApiKeys.agent = draft.agent?.provider?.hasApiKey === true;
  form.embeddingBaseUrl = draft.embedding?.baseUrl ?? form.embeddingBaseUrl;
  form.embeddingModel = draft.embedding?.model ?? form.embeddingModel;
  savedApiKeys.embedding = draft.embedding?.hasApiKey === true;
  form.dimensions = draft.embedding?.dimensions ?? form.dimensions;
  form.batchSize = draft.embedding?.batchSize ?? form.batchSize;
  form.rerankBaseUrl = draft.rerank?.baseUrl ?? form.rerankBaseUrl;
  form.rerankModel = draft.rerank?.model ?? form.rerankModel;
  savedApiKeys.rerank = draft.rerank?.hasApiKey === true;
  form.topN = draft.rerank?.topN ?? form.topN;
}

function draftPayload(): Record<string, unknown> {
  return {
    draft: {
      version: 1,
      workspace: { id: 'current', name: 'Current Workspace', rootPath: form.workspacePath },
      knowledge: { rootDir: form.knowledgeRoot, ...(form.sourceDir ? { sourceDir: form.sourceDir } : {}), buildVectorIndex: true },
      server: { bindMode: form.bindMode, port: Number(form.port) },
      agent: { providerId: 'default', provider: { type: 'openai-compatible', baseUrl: form.agentBaseUrl, model: form.agentModel } },
      embedding: { enabled: true, provider: 'siliconflow', baseUrl: form.embeddingBaseUrl, model: form.embeddingModel, dimensions: Number(form.dimensions), distance: 'cosine', batchSize: Number(form.batchSize), timeoutMs: 30000 },
      rerank: { enabled: true, provider: 'siliconflow', baseUrl: form.rerankBaseUrl, model: form.rerankModel, topN: Number(form.topN), timeoutMs: 30000 },
    },
    secrets: {
      ...(form.agentKey ? { agentApiKey: form.agentKey } : {}),
      ...(form.embeddingKey ? { embeddingApiKey: form.embeddingKey } : {}),
      ...(form.rerankKey ? { rerankApiKey: form.rerankKey } : {}),
    },
  };
}

async function run(): Promise<void> {
  try { await onboarding.save(draftPayload()); await onboarding.validate(); await onboarding.start(); } catch { /* visible */ }
}
function openPicker(field: typeof pickerField.value, event: MouseEvent): void { pickerField.value = field; pickerOpener.value = event.currentTarget as HTMLElement; pickerOpen.value = true; }
function selectPath(path: string): void { form[pickerField.value] = path; pickerOpen.value = false; }
function apiKeyHint(hasApiKey: boolean): string {
  return hasApiKey ? '已保存 API Key，留空将继续使用原记录。' : '当前未保存 API Key，留空则不设置。';
}
</script>

<template>
  <main class="setup-page">
    <header class="setup-hero"><p>super helper</p><h1>QuickStart：一键配置</h1><span>配置工作区、知识库和模型连接，完成后进入 Dashboard。</span></header>
    <p v-if="onboarding.error.value" class="error-banner" role="alert">{{ onboarding.error.value }}</p>
    <section class="setup-card">
      <h2>QuickStart</h2>
      <div class="path-fields">
        <label v-for="field in (['workspacePath', 'knowledgeRoot', 'sourceDir'] as const)" :key="field">
          {{ { workspacePath: '项目目录', knowledgeRoot: '知识库目录', sourceDir: '知识源目录' }[field] }}
          <span class="input-action"><input v-model="form[field]" /><button type="button" @click="openPicker(field, $event)">浏览…</button></span>
        </label>
      </div>
      <label>绑定模式<select v-model="form.bindMode"><option value="loopback">仅本机</option><option value="lan">可信内网</option></select></label>
      <p v-if="form.bindMode === 'lan'" class="warning-banner">当前页面和 API 暴露在可信内网，暂未实现鉴权。请只在可信内网使用。</p>
      <div class="provider-grid">
        <fieldset><legend>Agent</legend><label>Base URL<input v-model="form.agentBaseUrl" /></label><label>模型<input v-model="form.agentModel" /></label><label>API Key<input v-model="form.agentKey" type="password" autocomplete="off" /><small class="api-key-hint">{{ apiKeyHint(savedApiKeys.agent) }}</small></label></fieldset>
        <fieldset><legend>Embedding</legend><label>Base URL<input v-model="form.embeddingBaseUrl" /></label><label>模型<input v-model="form.embeddingModel" /></label><label>API Key<input v-model="form.embeddingKey" type="password" autocomplete="off" /><small class="api-key-hint">{{ apiKeyHint(savedApiKeys.embedding) }}</small></label></fieldset>
        <fieldset><legend>Rerank</legend><label>Base URL<input v-model="form.rerankBaseUrl" /></label><label>模型<input v-model="form.rerankModel" /></label><label>API Key<input v-model="form.rerankKey" type="password" autocomplete="off" /><small class="api-key-hint">{{ apiKeyHint(savedApiKeys.rerank) }}</small></label></fieldset>
      </div>
      <button type="button" @click="advanced = !advanced">{{ advanced ? '收起高级设置' : '高级设置' }}</button>
      <div v-if="advanced" class="field-grid"><label>端口<input v-model="form.port" type="number" /></label><label>Embedding dimensions<input v-model="form.dimensions" type="number" /></label><label>Embedding batchSize<input v-model="form.batchSize" type="number" /></label><label>Rerank topN<input v-model="form.topN" type="number" /></label></div>
    </section>
    <section class="setup-card"><h2>检查并执行</h2><div class="stack-actions"><button class="primary" type="button" :disabled="onboarding.loading.value" @click="run">检查并执行</button><button type="button" :disabled="!onboarding.run.value || onboarding.loading.value" @click="onboarding.retry">从失败阶段重试</button></div><pre>{{ validationText }}</pre></section>
    <section class="setup-card"><h2>进度</h2><progress :value="onboarding.run.value?.overallProgress || 0" max="100" /><p>{{ onboarding.run.value?.status || '尚未开始' }}</p><div class="stage-list"><article v-for="stage in onboarding.run.value?.stages || []" :key="String(stage.id)"><strong>{{ stage.id }}</strong><span>{{ stage.status }} {{ stage.progress || 0 }}%</span></article></div></section>
    <section v-if="onboarding.review.value?.required" class="setup-card review-gate-notice"><h2>完成知识审核后进入 Dashboard</h2><p>还有 {{ onboarding.review.value.pendingCount || 0 }} 条待审核、{{ onboarding.review.value.blockedCount || 0 }} 条阻断项，处理完成后才能进入 Dashboard。</p></section>
    <ReviewPanel :review="onboarding.review.value" :loading="onboarding.loading.value" @refresh="onboarding.loadReview" @submit="onboarding.submitReview" />
    <section v-if="onboardingCompleted && !onboarding.review.value?.required" class="setup-card success"><h2>开始使用</h2><p>配置与知识索引已准备完成。</p><a class="button-link" href="/">进入 Dashboard</a></section>
    <PathDialog :open="pickerOpen" :initial-path="form[pickerField]" :return-focus="pickerOpener" @close="pickerOpen = false" @select="selectPath" />
  </main>
</template>
