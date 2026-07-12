<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { progressView, type ChatProgressState } from './chat-progress';
const props = defineProps<{ progress: ChatProgressState }>();
const now = ref(Date.now());
const timer = setInterval(() => { now.value = Date.now(); }, 1_000);
onBeforeUnmount(() => clearInterval(timer));
const view = computed(() => progressView(props.progress, now.value));
</script>

<template>
  <section class="progress-card" :class="{ 'is-active': view.animated, interrupted: progress.state === 'interrupted' }" role="status" aria-live="polite">
    <header><div><strong>{{ view.title }}</strong><p>{{ view.summary }}</p></div><span>{{ view.percent }}%</span></header>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="view.percent"><span :style="{ width: `${view.percent}%` }" /></div>
    <div class="progress-steps"><span v-for="(step, index) in view.steps" :key="step" :class="{ done: index < view.activeIndex, current: index === view.activeIndex }">{{ step }}</span></div>
    <footer><span>{{ view.elapsedLabel }}</span><span>{{ view.heartbeatLabel }}</span><span>{{ view.estimateLabel }}</span></footer>
    <p v-if="view.stale && view.animated" class="warning-banner">暂时没有新进展，仍在等待服务返回；超过超时阈值会明确停止。</p>
  </section>
</template>
