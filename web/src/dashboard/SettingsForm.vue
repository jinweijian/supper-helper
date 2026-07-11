<script setup lang="ts">
import { reactive, watch } from 'vue';

const props = defineProps<{ settings: Record<string, any>; status: string; error: string; loading: boolean }>();
const emit = defineEmits<{
  saveModel: [value: Record<string, unknown>];
  testModel: [value: Record<string, unknown>];
  testEmbedding: [value: Record<string, unknown>];
  testRerank: [value: Record<string, unknown>];
}>();
const form = reactive({ providerId: '', model: '', baseUrl: '', apiKeyEnv: '', apiKey: '', contextWindowTokens: 1_000_000 });

watch(() => props.settings, (settings) => {
  const activeProviderId = settings.agent?.modelProvider ?? Object.keys(settings.models?.providers ?? {})[0] ?? 'default';
  const model = settings.models?.providers?.[activeProviderId] ?? settings.model ?? {};
  form.providerId = activeProviderId;
  form.model = model.model ?? '';
  form.baseUrl = model.baseUrl ?? '';
  form.apiKeyEnv = model.apiKeyEnv ?? '';
  form.apiKey = '';
  form.contextWindowTokens = settings.agent?.contextWindowTokens ?? model.contextWindowTokens ?? 1_000_000;
}, { immediate: true });

function payload(data?: FormData): Record<string, unknown> {
  return {
    providerId: String(data?.get('providerId') ?? form.providerId),
    model: String(data?.get('model') ?? form.model),
    baseUrl: String(data?.get('baseUrl') ?? form.baseUrl),
    apiKeyEnv: String(data?.get('apiKeyEnv') ?? form.apiKeyEnv),
    ...(String(data?.get('apiKey') ?? form.apiKey) ? { apiKey: String(data?.get('apiKey') ?? form.apiKey) } : {}),
    contextWindowTokens: Number(data?.get('contextWindowTokens') ?? form.contextWindowTokens),
  };
}

function submit(event: Event): void {
  emit('saveModel', payload(new FormData(event.currentTarget as HTMLFormElement)));
}
</script>

<template>
  <form class="settings-form" @submit.prevent="submit">
    <div class="field-grid">
      <label>Provider ID<input v-model="form.providerId" name="providerId" /></label>
      <label>模型<input v-model="form.model" name="model" /></label>
    </div>
    <label>Base URL<input v-model="form.baseUrl" name="baseUrl" type="url" /></label>
    <div class="field-grid">
      <label>API Key 环境变量<input v-model="form.apiKeyEnv" name="apiKeyEnv" /></label>
      <label>API Key<input v-model="form.apiKey" name="apiKey" type="password" autocomplete="off" placeholder="留空则保持原值" /></label>
    </div>
    <label>上下文窗口 Tokens<input v-model="form.contextWindowTokens" name="contextWindowTokens" type="number" min="1" /></label>
    <p v-if="error" class="error-banner">{{ error }}</p>
    <p v-else class="status-banner">{{ status || '可先测试连接，再保存配置。' }}</p>
    <div class="stack-actions">
      <button type="button" :disabled="loading" @click="emit('testModel', payload())">测试模型</button>
      <button type="button" :disabled="loading" @click="emit('testEmbedding', settings.embedding || {})">测试 Embedding</button>
      <button type="button" :disabled="loading" @click="emit('testRerank', settings.rerank || {})">测试 Rerank</button>
      <button class="primary" type="submit" :disabled="loading">保存配置</button>
    </div>
  </form>
</template>
