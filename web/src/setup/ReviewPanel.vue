<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{ review?: Record<string, any>; loading: boolean }>();
const emit = defineEmits<{ refresh: [query: string]; submit: [input: Record<string, unknown>] }>();
const severity = ref('all');
const search = ref('');
const notes = ref('');
const selected = ref<string[]>([]);
const items = computed(() => props.review?.items ?? []);
function query(): string { return `?severity=${severity.value}&search=${encodeURIComponent(search.value)}`; }
function submit(action: 'approve' | 'request_edits' | 'reject'): void {
  emit('submit', { action, ids: selected.value, notes: notes.value });
}
</script>

<template>
  <section v-if="review?.required" class="setup-card">
    <h2>审核知识切片</h2>
    <p class="muted">待审核 {{ review.pendingCount || 0 }}，blocked {{ review.blockedCount || 0 }}。</p>
    <div class="review-tools">
      <label>严重级别<select v-model="severity"><option value="all">全部</option><option value="warn">警告</option><option value="error">错误</option></select></label>
      <label>搜索<input v-model="search" placeholder="按标题、来源或问题原因搜索" /></label>
      <button type="button" :disabled="loading" @click="emit('refresh', query())">刷新审核项</button>
    </div>
    <div class="review-list">
      <label v-for="item in items" :key="item.id" class="review-item">
        <input v-model="selected" type="checkbox" :value="item.id" />
        <span><strong>{{ item.title }}</strong><small>{{ item.qualitySeverity }} · {{ item.path }}</small></span>
      </label>
    </div>
    <label>审核备注<input v-model="notes" placeholder="记录人工判断依据" /></label>
    <div class="stack-actions">
      <button class="primary" type="button" :disabled="!selected.length || loading" @click="submit('approve')">发布选中</button>
      <button type="button" :disabled="!selected.length || loading" @click="submit('request_edits')">退回修改</button>
      <button type="button" :disabled="!selected.length || loading" @click="submit('reject')">不发布选中</button>
    </div>
  </section>
</template>
