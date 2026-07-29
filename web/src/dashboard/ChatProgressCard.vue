<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { progressView, type ChatProgressState } from './chat-progress';
const props = defineProps<{ progress: ChatProgressState }>();
const emit = defineEmits<{ retry: [] }>();
const now = ref(Date.now());
const timer = setInterval(() => { now.value = Date.now(); }, 1_000);
onBeforeUnmount(() => clearInterval(timer));
const view = computed(() => progressView(props.progress, now.value));
const isRetryable = computed(() => props.progress.state === 'interrupted' && props.progress.session?.retryableTurn);
</script>

<template>
  <section class="progress-line" :class="{ interrupted: progress.state === 'interrupted', 'is-active': view.animated }" role="status" aria-live="polite">
    <span class="progress-dot" aria-hidden="true" />
    <span class="progress-title">{{ view.title }}</span>
    <span class="progress-meta">{{ view.elapsedLabel }} · {{ view.estimateLabel }}</span>
    <span v-if="view.stale && view.animated" class="progress-stale">等待服务返回中…</span>
    <span v-if="progress.state === 'interrupted'" class="progress-meta">{{ view.summary }}</span>
    <button v-if="isRetryable" type="button" class="retry-button" @click="emit('retry')">一键重试</button>
  </section>
</template>
