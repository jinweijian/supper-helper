<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SessionDto } from '../shared/contracts';

const props = defineProps<{ session?: SessionDto; health?: Record<string, unknown>; loading: boolean; error: string }>();
const emit = defineEmits<{ check: []; bind: []; reindex: [] }>();
const tab = ref<'progress' | 'evidence' | 'health'>('progress');
const latestRun = computed(() => props.session?.runs.at(-1));
</script>

<template>
  <aside class="insight-panel">
    <h2>诊断审计</h2>
    <div class="tab-row" role="tablist">
      <button v-for="item in ['progress', 'evidence', 'health'] as const" :key="item" type="button" role="tab" :aria-selected="tab === item" :class="{ active: tab === item }" @click="tab = item">
        {{ { progress: '进度', evidence: '证据', health: '知识健康' }[item] }}
      </button>
    </div>
    <section v-if="tab === 'progress'">
      <h3>当前状态</h3>
      <p>{{ session?.status || '尚未开始' }}</p>
      <pre v-if="latestRun">{{ JSON.stringify(latestRun, null, 2) }}</pre>
    </section>
    <section v-else-if="tab === 'evidence'">
      <h3>最近运行证据</h3>
      <pre>{{ JSON.stringify(latestRun || {}, null, 2) }}</pre>
    </section>
    <section v-else>
      <h3>知识库状态</h3>
      <p v-if="error" class="error-banner">{{ error }}</p>
      <pre>{{ JSON.stringify(health || session?.knowledgeHealth || {}, null, 2) }}</pre>
      <div class="stack-actions">
        <button type="button" :disabled="loading" @click="emit('check')">测试检索</button>
        <button type="button" :disabled="loading" @click="emit('bind')">绑定知识库</button>
        <button type="button" :disabled="loading" @click="emit('reindex')">重建索引</button>
      </div>
    </section>
  </aside>
</template>
