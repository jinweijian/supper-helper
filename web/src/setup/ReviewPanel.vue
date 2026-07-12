<script setup lang="ts">
import { computed, ref, watch } from 'vue';

interface ReviewIssue {
  code?: string;
  message?: string;
  explanation?: {
    reason?: string;
    impact?: string;
    suggestion?: string;
    missingInfo?: string[];
  };
}

interface ReviewItem {
  id: string;
  title?: string;
  module?: string;
  path?: string;
  qualitySeverity?: string;
  qualityStatus?: string;
  pipelineStatus?: string;
  excerptPreview?: string;
  issues?: ReviewIssue[];
}

const props = defineProps<{ review?: Record<string, any>; loading: boolean }>();
const emit = defineEmits<{ refresh: [query: string]; submit: [input: Record<string, unknown>] }>();
const severity = ref('all');
const search = ref('');
const notes = ref('');
const selected = ref<string[]>([]);
const items = computed<ReviewItem[]>(() => props.review?.items ?? []);
const pageIds = computed(() => items.value.map((item) => String(item.id)));
const selectedItems = computed(() => items.value.filter((item) => selected.value.includes(String(item.id))));
const hasSelectedError = computed(() => selectedItems.value.some((item) => item.qualitySeverity === 'error'));

watch(pageIds, (ids) => {
  const visible = new Set(ids);
  selected.value = selected.value.filter((id) => visible.has(id));
});

function query(): string { return `?severity=${severity.value}&search=${encodeURIComponent(search.value)}`; }
function selectPage(): void { selected.value = [...pageIds.value]; }
function clearSelection(): void { selected.value = []; }
function refresh(): void {
  clearSelection();
  emit('refresh', query());
}
function submit(action: 'approve' | 'request_edits' | 'reject'): void {
  if (selected.value.length === 0 || (action === 'approve' && hasSelectedError.value)) return;
  emit('submit', { action, ids: [...selected.value], notes: notes.value });
  clearSelection();
}
</script>

<template>
  <section v-if="review?.required" class="setup-card">
    <h2>审核知识切片</h2>
    <p class="muted">待审核 {{ review.pendingCount || 0 }}，阻断 {{ review.blockedCount || 0 }}。</p>
    <div class="review-tools">
      <label>严重级别<select v-model="severity"><option value="all">全部</option><option value="warn">警告</option><option value="error">错误</option></select></label>
      <label>搜索<input v-model="search" placeholder="按标题、来源或问题原因搜索" /></label>
      <button data-testid="refresh-review" type="button" :disabled="loading" @click="refresh">刷新审核项</button>
    </div>
    <div class="review-selection">
      <span>已选 {{ selected.length }} / 本页 {{ items.length }} 条</span>
      <button data-testid="select-page" type="button" :disabled="loading || !items.length" @click="selectPage">全选本页</button>
      <button data-testid="clear-selection" type="button" :disabled="loading || !selected.length" @click="clearSelection">取消全选</button>
    </div>
    <p v-if="!items.length" class="muted">当前筛选条件下没有待审核项目。</p>
    <div v-else class="review-list">
      <article v-for="item in items" :key="item.id" class="review-item">
        <label class="review-item-heading">
          <input v-model="selected" type="checkbox" :value="item.id" />
          <span><strong>{{ item.title }}</strong><small>{{ item.path }}</small></span>
        </label>
        <div class="review-statuses">
          <span>模块：{{ item.module || '未标注' }}</span>
          <span>严重级别：{{ item.qualitySeverity }}</span>
          <span v-if="item.qualityStatus">质量状态：{{ item.qualityStatus }}</span>
          <span v-if="item.pipelineStatus">管线状态：{{ item.pipelineStatus }}</span>
        </div>
        <p class="review-summary"><strong>内容摘要</strong>{{ item.excerptPreview || '没有可展示的内容摘要。' }}</p>
        <div v-if="item.issues?.length" class="review-issues">
          <article v-for="(issue, index) in item.issues" :key="`${item.id}-${issue.code || index}`" class="review-issue">
            <strong>{{ issue.message || issue.code || '质量问题' }}</strong>
            <p v-if="issue.explanation?.reason">{{ issue.explanation.reason }}</p>
            <p v-if="issue.explanation?.impact">{{ issue.explanation.impact }}</p>
            <p v-if="issue.explanation?.suggestion">{{ issue.explanation.suggestion }}</p>
            <p v-if="issue.explanation?.missingInfo?.length">缺失信息：{{ issue.explanation.missingInfo.join('；') }}</p>
          </article>
        </div>
      </article>
    </div>
    <label>审核备注<input v-model="notes" placeholder="记录人工判断依据" /></label>
    <p v-if="hasSelectedError" class="warning-banner">错误级别项目不能发布，请退回修改或选择不发布。</p>
    <div class="stack-actions">
      <button data-testid="approve-selected" class="primary" type="button" :disabled="!selected.length || hasSelectedError || loading" @click="submit('approve')">发布选中</button>
      <button type="button" :disabled="!selected.length || loading" @click="submit('request_edits')">退回修改</button>
      <button type="button" :disabled="!selected.length || loading" @click="submit('reject')">不发布选中</button>
    </div>
  </section>
</template>
